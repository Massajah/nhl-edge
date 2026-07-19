const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const serverRoot = path.resolve(__dirname, '..')
const ignoredDirectories = new Set(['node_modules'])

const collectJavaScriptFiles = (directory) => {
  const entries = fs.readdirSync(directory, { withFileTypes: true })

  return entries.flatMap((entry) => {
    const fullPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      return ignoredDirectories.has(entry.name)
        ? []
        : collectJavaScriptFiles(fullPath)
    }

    return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : []
  })
}

const files = collectJavaScriptFiles(serverRoot)
let hasFailure = false

files.forEach((file) => {
  const result = spawnSync(process.execPath, ['--check', file], {
    encoding: 'utf8',
  })

  if (result.status !== 0) {
    hasFailure = true
    console.error(result.stdout)
    console.error(result.stderr)
  }
})

if (hasFailure) {
  process.exit(1)
}

console.log(`Syntax check passed for ${files.length} server JavaScript files.`)
