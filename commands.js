const _keyword = (k) => (words, op) => {
  if (words.length > 0 && words[0] == k) {
    return [words.slice(1)]
  }
  return false
}

const matcher = x => {
  if (typeof x == 'string') {
    return _keyword(x)
  }
  return x
}

const name = (field, regex) => (words, op) => {
  if (words.length > 0 && words[0].match(regex)) {
    op[field] = words[0]
    return [words.slice(1)]
  }
  return false
}

const all = (...m) => (words, op) => {
  for (let i = 0; i < m.length; i++) {
    let r = matcher(m[i])(words, op)
    if (r) {
      words = r[0]
    } else {
      return false
    }
  }
  return [words]
}

const first = (words, op, m) => {
  for (let i = 0; i < m.length; i++) {
    let r = matcher(m[i])(words, op)
    if (r) {
      return r
    }
  }
  return false
}
const any = (...m) => (words, op) => {
  for (;;) {
    let r = first(words, op, m)
    if (!r) {
      return [words]
    }
    words = r[0]
  }
}

const p = g => (w, o) => {
  g(w, o)
  return o
}

const clusterNameSpec = /^[a-z][a-z0-9_-]+$/
const hourSpec        = /^\d+h$/
const regionSpec      = /^..-.+$/
const instanceSpec    = /^g\d-.+-\d$/
const versionSpec     = /^v\d+\.\d+$/

const parse = s => {
  let w = s.split(/\s+/)
  let command = w[0]; w = w.slice(1)
  switch (command) {
    case 'xyzzy': return {op: 'xyzzy'}
    case 'check': return {op: 'check'}
    case 'help':  return {op: 'help'}
    case 'info':  return {op: 'info'}
    case 'list':  return {op: 'list'}
    case 'renew':
      return p(all(
        name('cluster', clusterNameSpec),
        any(
          all('for', name('life', hourSpec)),
        ),
      ))(w, { op: 'renew' })

    case 'expire':
      return p(all(
        name('cluster', clusterNameSpec),
      ))(w, { op: 'expire' })

    case 'deploy':
      return p(all(
        name('cluster', clusterNameSpec),
        any(
          all('for', name('life',     hourSpec)),
          all('in',  name('region',   regionSpec)),
          all('on',  name('instance', instanceSpec)),
          name('version', versionSpec),
          all('with', name('size', /^\d+$/), 'nodes'),
        )
      ))(w, { op: 'deploy' })

    case 'teardown':
      return p(all(
        name('cluster', clusterNameSpec),
      ))(w, { op: 'teardown' })

    case 'access':
      return p(all(
        name('cluster', clusterNameSpec),
      ))(w, { op: 'access' })
  }
}

/*
const check = s => {
  console.log(s)
  console.dir(JSON.stringify(parse(s)))
}
check("deploy foo")
check("deploy foo on g6-standard-2 in us-west")
check("deploy foo on g6-standard-2 in us-west v1.4")
*/

module.exports = {
  parse,
}
