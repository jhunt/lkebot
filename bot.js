const { Context } = require('./lke')

const lines = (...s) => s.filter(s => s != null).join("\n")

const ll = s => s.split(/\s*,\s*/).filter(s => s != '')
const nn = (s, min) => {
  let n = parseInt(s)
  return n != null && n > min ? n : min
}

const MaxClusters   = nn(process.env.LKE_MAX_CLUSTERS      || '5', 1)
const MaxNodes      = nn(process.env.LKE_MAX_NODES         || '3', 1)
const OffLimits     = ll(process.env.LKEBOT_OFF_LIMITS     || '')
const SweepInterval = nn(process.env.LKEBOT_SWEEP_INTERVAL || '0', 0)

const LKE = new Context(
                  process.env.LINODE_TOKEN || 'no-token-provided',
                  {
                    offLimits:   OffLimits,
                    maxNodes:    MaxNodes,
                    maxClusters: MaxClusters,
                  }
                )

const go = async (op, say) => {
  switch (op ? op.op : 'nothing') {
    case 'xyzzy':
      say('```'+JSON.stringify(LKE, null, 2)+'```')
      return

    case 'check':
      LKE.refresh()
      say('ok.')
      return

    case 'help':
      say(lines(
        'hi there! i can help deploy Linode LKE instances!',
        '',

        'say `info` to get my current limits / parameters.',
        'say `list` to see currently deployed clusters.',
        'say `deploy NAME` to deploy a new cluster.',
        'say `renew NAME` to renew the lease on a cluster.',
        'say `expire NAME` to drop the lease on a cluster.',
        'say `teardown NAME` to decommission a cluster.',
        'say `access NAME` to get a cluster\'s kubeconfig.'
      ))
      return

    case 'info':
      say(lines(
        `i am allowed to deploy up to *${MaxClusters} clusters*`,
        `each of which can be (at most) *${MaxNodes} nodes* in size.`,
        OffLimits.length > 0
          ? `i am forbidden from interacting with the following clusters: ${OffLimits.map(n => '`'+n+'`').join(', ')}`
          : null,
        SweepInterval > 0
          ? `i check for (and teardown!) expired clusters every *${SweepInterval} minutes*`
          : null
      ))
      return

    case 'list':
      let names = Object.values(LKE.clusters).map(c => c.toString())
      if (names.length == 0) {
        say(lines(
          `i have not deployed any clusters yet.`,
          `to get started, try "deploy a-test-cluster"`
        ))
      } else {
        say(lines(
          `i am watching ${names.length} cluster(s):`,
          ...names,
        ))
      }
      return

    case 'renew':
      LKE.renew(op.cluster, op.life)
      say(`renewing ${op.cluster} for ${op.life} more hours`)
      return

    case 'expire':
      LKE.expire(op.cluster)
      say(`dropping lease on ${op.cluster} IMMEDIATELY :boom:`)
      return

    case 'deploy':
      if (!op.cluster) {
        say('what do you want to call your new cluster? you might try `deploy my-cluster`')
        return
      }

      let spec = {
        region:   op.region,
        instance: op.instance,
        size:     op.size,
        life:     op.life,
      }
      let err = LKE.cannotDeploy(spec)
      if (err) {
        switch (err) {
          case Context.ErrTooManyClustersAlready:
            say("hrm. i have already deployed my quota for clusters. sorry.")
            break

          case Context.ErrClusterTooLarge:
            say("oops. the cluster you're asking for is larger than what i am allowed to deploy.")
            break

          default:
            say(":boom: something broke; ask my handler about the error `"+err+"`")
            break
        }
        return
      }
      await say("you got it! deploying..")
      LKE.deploy(op.cluster, spec)
      return

    case 'teardown':
      LKE.teardown(op.cluster)
      say(`tearing down ${op.cluster} IMMEDIATELY :boom:`)
      return

    case 'access':
      await say('let me get that kubeconfig for you...')

      let kc = await LKE.access(op.cluster)
      if (!kc) {
        say(lines(
          'hrmm. that cluster may still be provisioning?'
        ))
      } else {
        say(lines(
          `here you go:`,
          '```'+kc+'```'
        ))
      }
      return

    default:
      say('Odd. I seem to have malfunctioned. :flushed:')
      return
  }
}

const sweeper = () => {
  let fn = () => {
    console.log('sweeping...')
    LKE.sweep()
  }

  if (SweepInterval > 0) {
    fn()
    setInterval(fn, 1000 * 60 * SweepInterval)
  } else {
    console.log('no sweep interval set; skipping sweeper setup')
  }
}

const init = () => {
  sweeper()
}

module.exports = {
  init,
  go
}
