const t = require('tap')
const { format } = require('tcompare')
const loadActual = require('../lib/load-actual.js')
const { resolve, dirname, relative } = require('path')
const { realpathSync } = require('fs')

const {
  fixtures,
  roots,
  symlinks,
} = require('./fixtures/index.js')

// two little helper functions to make the loaded trees
// easier to look at in the snapshot results.
const printEdge = (edge, inout) => ({
  name: edge.name,
  type: edge.type,
  spec: edge.spec,
  ...(inout === 'in' ? {
    from: edge.from && edge.from.location,
  } : {
    to: edge.to && edge.to.location,
  }),
  ...(edge.error ? { error: edge.error } : {}),
  __proto__: { constructor: edge.constructor },
})

const printTree = tree => ({
  name: tree.name,
  location: tree.location,
  ...(tree.extraneous ? { extraneous: true } : {
    ...(tree.dev ? { dev: true } : {}),
    ...(tree.optional ? { optional: true } : {}),
    ...(tree.devOptional && !tree.dev && !tree.optional
      ? { devOptional: true } : {}),
  }),
  ...(tree.errors.length
    ? {
      errors: tree.errors.map(error => ({
        code: error.code,
        ...(error.path ? { path: relative(__dirname, error.path) }
          : {}),
      })),
    } : {}),
  ...(tree.isLink ? {
    target: {
      name: tree.target.name,
      parent: tree.target.parent && tree.target.parent.location
    }
  } : {}),
  ...(tree.inBundle ? { bundled: true } : {}),
  ...(tree.edgesIn.size ? {
    edgesIn: new Set([...tree.edgesIn]
      .sort((a, b) => a.from.location.localeCompare(b.from.location))
      .map(edge => printEdge(edge, 'in'))),
  } : {}),
  ...(tree.edgesOut.size ? {
    edgesOut: new Map([...tree.edgesOut.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, edge]) => [name, printEdge(edge, 'out')]))
  } : {}),
  ...( tree.target || !tree.children.size ? {}
    : {
      children: new Map([...tree.children.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, tree]) => [name, printTree(tree)]))
    }),
  __proto__: { constructor: tree.constructor },
})

t.formatSnapshot = tree => format(printTree(tree), { sort: false })

roots.forEach(root => {
  const dir = resolve(fixtures, root)
  t.test(root, t => loadActual(dir).then(tree =>
    t.matchSnapshot(tree, 'loaded tree')))
})

t.test('looking outside of cwd', t => {
  const cwd = process.cwd()
  t.teardown(() => process.chdir(cwd))
  process.chdir('test/fixtures/selflink')
  const dir = '../root'
  return loadActual(dir).then(tree =>
    t.matchSnapshot(tree, 'loaded tree'))
})

t.test('cwd is default root', t => {
  const cwd = process.cwd()
  t.teardown(() => process.chdir(cwd))
  process.chdir('test/fixtures/root')
  return loadActual().then(tree =>
    t.matchSnapshot(tree, 'loaded tree'))
})

t.test('shake out Link target timing issue', t => {
  process.env._TEST_ARBORIST_SLOW_LINK_TARGET_ = '1'
  t.teardown(() => process.env._TEST_ARBORIST_SLOW_LINK_TARGET_ = '')
  const dir = resolve(fixtures, 'selflink')
  return loadActual(dir).then(tree =>
    t.matchSnapshot(tree, 'loaded tree'))
})

t.test('broken json', t =>
  loadActual(resolve(fixtures, 'bad')).then(d => {
    t.ok(d.errors.length, 'Got an error object')
    t.equal(d.errors[0] && d.errors[0].code, 'EJSONPARSE')
    t.ok(d, 'Got a tree')
  }))

t.test('missing json does not obscure deeper errors', t =>
  loadActual(resolve(fixtures, 'empty')).then(d => {
    t.match(d, { errors: [{ code: 'ENOENT' }] },
      'Error reading json of top level')
    t.match(d.children.get('foo'), { errors: [{ code: 'EJSONPARSE' }] },
      'Error parsing JSON of child node')
  }))

t.test('missing folder', t =>
  t.rejects(loadActual(resolve(fixtures, 'does-not-exist')), {
    code: 'ENOENT'
  }))

t.test('missing symlinks', t =>
  loadActual(resolve(fixtures, 'badlink')).then(d => {
    t.is(d.children.size, 2, 'both broken children are included')
    t.match(d.children.get('foo'), { errors: [{ code: 'ELOOP' }] },
      'foo has error')
    t.match(d.children.get('bar'), { errors: [{ code: 'ENOENT' }] },
      'bar has error')
  }))

t.test('realpath gutchecks', t => {
  // the realpath module is tested pretty thoroughly, but
  // while we've got a bunch of symlinks being created, may as well
  // give it a quick integration pass.
  const d = resolve(__dirname, 'fixtures')
  const realpath = require('../lib/realpath.js')
  Object.keys(symlinks).map(link => t.test(link, t =>
    realpath(
      resolve(d, link),
      new Map(),
      new Map(),
      0
    ).then(
      real => t.equal(real, realpathSync(resolve(d, link))),
      er => t.throws(()=> realpathSync(resolve(d, link)))
    )))
  t.end()
})
