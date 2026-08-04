import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const distDir = path.join(__dirname, '../dist/server')

function processFile(file) {
  let content = fs.readFileSync(file, 'utf8')
  const original = content
  content = content.replace(/(?<=from\s+['"])(\.[^'"]+?)(?<!\.js)(?=['"])/g, '$1.js')
  if (content !== original) {
    fs.writeFileSync(file, content, 'utf8')
    console.log(`Updated imports in ${path.relative(distDir, file)}`)
  }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith('.js')) processFile(full)
  }
}

if (fs.existsSync(distDir)) {
  walk(distDir)
}
