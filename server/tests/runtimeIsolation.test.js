const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const serverRoot = path.resolve(__dirname, '..')
const runtimeEntries = [
  'app.js',
  'index.js',
  'calibration',
  'config',
  'controllers',
  'diagnostics',
  'middleware',
  'models',
  'routes',
  'scripts',
  'services',
  'utils',
]
const clientSourceReference =
  /(?:\.\.[\\/])+client[\\/]|client[\\/]src[\\/]/i

const collectJavaScriptFiles = (entryPath) => {
  const stats = fs.statSync(entryPath)

  if (stats.isFile()) {
    return entryPath.endsWith('.js') ? [entryPath] : []
  }

  return fs.readdirSync(entryPath, { withFileTypes: true }).flatMap((entry) =>
    collectJavaScriptFiles(path.join(entryPath, entry.name)),
  )
}

test('server runtime source has no dependency on client source', () => {
  const offenders = runtimeEntries
    .flatMap((entry) => collectJavaScriptFiles(path.join(serverRoot, entry)))
    .filter((file) => clientSourceReference.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(serverRoot, file))

  assert.deepEqual(offenders, [])
})
