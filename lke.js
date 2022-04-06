const {
  setToken,
  getKubernetesClusters,
  getNodePools,
  createKubernetesCluster,
  deleteKubernetesCluster,
  getKubeConfig,
} = require('@linode/api-v4');

const IsDeploying   = 'deploying'
const IsLive        = 'live'
const IsTerminating = 'terminating'
const IsGone        = 'gone'

const ErrTooManyClustersAlready = 'too-many-clusters-already'
const ErrClusterTooLarge        = 'cluster-too-large'

const addHours = (d, h) => new Date(d.getTime() + h * 3600 * 1000)

const DefaultClusterSpec = {
  region:   process.env.LKE_DEFAULT_REGION   || 'us-east',
  instance: process.env.LKE_DEFAULT_INSTANCE || 'g6-standard-2',
  size:     process.env.LKE_DEFAULT_SIZE     || '1',
  version:  process.env.LKE_DEFAULT_VERSION  || '1.22',
  life:     process.env.LKE_DEFAULT_LIFETIME || '8',
}

class ClusterSpec {
  constructor(spec) {
    this.region   = spec.region   || DefaultClusterSpec.region
    this.instance = spec.instance || DefaultClusterSpec.instance
    this.version  = spec.version  || DefaultClusterSpec.version
    this._size    = spec.size     || DefaultClusterSpec.size
    this._life    = spec.life     || DefaultClusterSpec.life
  }

  get size() {
    let n = parseInt(this._size)
    return n > 1 ? n : 1
  }

  get life() {
    let n = parseInt(this._life)
    return n > 1 ? n : 1
  }
}

const failedTo = (msg, e) => {
  console.error(`failed to ${msg}:`)
  if (e.response && e.response.data && e.response.data.errors) {
    e.response.data.errors.map(console.error)
  } else {
    console.error('(unspecified failure)')
  }
  return null
}

class Cluster {
  constructor(name, status, spec) {
    this.id       = null
    this.name     = name
    this.version  = spec.version
    this.region   = spec.region
    this.instance = spec.instance
    this.size     = spec.size
    this.life     = spec.life

    this.status    = status,
    this.createdAt = new Date()
    this.expiresAt = addHours(this.createdAt, this.life)
  }

  minutesLeft() {
    let today = new Date()
    let ms = this.expiresAt.getTime() - today.getTime()
    return ms / 60 / 1000;
  }

  isDeploying()   { return this.status == IsDeploying }
  isLive()        { return this.status == IsLive }
  isTerminating() { return this.status == IsTerminating }
  isGone()        { return this.status == IsGone }

  toString() {
    if (this.isGone()) {
      return `${this.name} _[gone]_`
    }
    if (this.isTerminating()) {
      return `${this.name} _[terminating]_`
    }
    if (this.isDeploying()) {
      return `${this.name} _[deploying]_`
    }

    let left = this.expired()
             ? 'EXPIRED'
             : `${Math.round(this.minutesLeft() / 60)}h left`
    return `${this.name} [${this.size}-node] _${left}_`
  }

  expired() {
    return this.expiresAt <= new Date()
  }

  renew(hours) {
    this.expiresAt = addHours(this.expiresAt, hours)
  }

  expire() {
    this.expiresAt = new Date()
  }

  async deploy() {
    return await createKubernetesCluster({
      label:       this.name,
      region:      this.region,
      k8s_version: this.version,
      node_pools: [{
        type:  this.instance,
        count: this.size,
      }],
    }).catch(e => failedTo(`create cluster '${this.name}'`, e))
  }

  async teardown() {
    if (this.id) {
      console.log(`[lke] tearing down cluster "${this.name}" [${this.id}] ...`)
      this.status = IsTerminating

      deleteKubernetesCluster(this.id)
        .catch(e => failedTo(`delete cluster '${this.name}'`, e))
    }
  }

  async kubeconfig() {
    return getKubeConfig(this.id)
      .then(raw => Buffer.from(raw.kubeconfig, 'base64').toString('ascii'))
      .catch(e => failedTo(`retrieve kubeconfig for '${this.name}'`, e))
  }
}

class Context {
  constructor(token, options = {}) {
    setToken(token)
    this.clusters    = {}
    this.offLimits   = options.offLimits   || []
    this.maxNodes    = options.maxNodes    || DefaultClusterSpec.size,
    this.maxClusters = options.maxClusters || 1
  }

  allowed(cluster) {
    return !this.offLimits.includes(cluster)
  }

  within(name, fn) {
    let cluster = this.clusters[name]
    if (cluster) {
      return fn(cluster)
    }

    console.warn(`cluster [${name}] not found...`)
    return null
  }

  async refresh() {
    console.log(`[lke] refreshing list of clusters from upstream...`)
    // LKE only ever gives back 'ready' or 'not_ready'
    const translateStatus = (is, was) => is == 'ready' ? IsLive : was

    // first we mark
    for (let k in this.clusters) {
      this.clusters[k].seen = false
    }

    // then we reconcile
    let r = await getKubernetesClusters()
    r.data.map(async c => {
      if (!this.clusters[c.label]) {
        let spec = new ClusterSpec({})

        let np = await getNodePools(c.id)
        if (np.data.length == 1) {
          spec = new ClusterSpec({
            region:   c.region,
            version:  c.version,
            instance: np.data[0].type,
            size:     np.data[0].count,
          })
        }
        console.log(`[lke] found ${spec.size}-node v${spec.version} cluster "${c.label}" (on ${spec.instance}) with status "${c.status}"`)
        this.clusters[c.label] = new Cluster(c.label, translateStatus(c.status, IsDeploying), spec)
      }
      this.clusters[c.label].lke = c
      this.clusters[c.label].id = c.id
      this.clusters[c.label].seen = true
      this.clusters[c.label].status = translateStatus(c.status, this.clusters[c.label].status)
    })

    // and then we cleanup
    let now = new Date()
    for (let k in this.clusters) {
      if (!this.clusters[k].seen) {
        if (this.clusters[k].isLive() || this.clusters[k].isTerminating()) {
          console.log(`[lke] cluster "${k}" not found upstream; setting to GONE status`)
          this.clusters[k].status = IsGone
          this.clusters[k].deleteAfter = addHours(now, 0.25)
        }
        if (this.clusters[k].deleteAfter <= now) {
          console.log(`[lke] cluster "${k}" has been GONE long enough; dropping it from the list`)
          delete this.clusters[k]
        }
      }
    }
  }

  async renew(name, hours) {
    this.within(name, cluster => cluster.renew(hours || 1))
  }

  async expire(name) {
    this.within(name, cluster => cluster.expire())
  }

  cannotDeploy(spec) {
    let live = Object.values(this.clusters).filter(c => !c.isGone())
    if (live.length >= this.maxClusters) {
      return ErrTooManyClustersAlready
    }
    if (spec.size > this.maxNodes) {
      return ErrClusterTooLarge
    }
    return null
  }

  async deploy(name, spec) {
    if (this.cannotDeploy(spec)) {
      return
    }

    console.log(`[lke] deploying new cluster "${name}" ...`)
    let cluster = new Cluster(name, IsDeploying, new ClusterSpec(spec))
    this.clusters[name] = cluster
    cluster.deploy()
    this.refresh()
  }

  async teardown(name) {
    this.within(name, cluster => cluster.teardown()
                                        .then(() => this.refresh()))
  }

  access(name) {
    return this.within(name, c => c.kubeconfig())
  }

  async sweep() {
    let promises = []

    for (let name in this.clusters) {
      let cluster = this.clusters[name]
      if (cluster.expired()) {
        promises.push(cluster.teardown())

        // FIXME send messages to owners that their clusters are now defunct
      }
    }

    return Promise.all(promises)
                  .then(() => this.refresh())
  }
}

Context.ErrTooManyClustersAlready = ErrTooManyClustersAlready
Context.ErrClusterTooLarge        = ErrClusterTooLarge

module.exports = {
  Context,
}
