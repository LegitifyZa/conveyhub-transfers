import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

import { buildManifest, checkManifest } from './migration-manifest.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const migrationsDir = path.join(root, 'src/lib/migrations')
const manifestPath = path.join(migrationsDir, 'manifest.json')

test('manifest.json exists, is complete and matches the migration bytes', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  assert.equal(manifest.artifact, 'transfers-migrations')
  assert.equal(manifest.algorithm, 'sha256-over-raw-file-bytes')
  const sqlFiles = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort()
  assert.equal(manifest.files.length, sqlFiles.length)
  assert.equal(manifest.fileCount, sqlFiles.length)
  assert.deepEqual(manifest.files.map(f => f.file), sqlFiles)
  for (const f of sqlFiles) {
    const bytes = fs.readFileSync(path.join(migrationsDir, f), 'utf8')
    const recorded = manifest.files.find(m => m.file === f)
    assert.equal(
      recorded.sha256,
      createHash('sha256').update(bytes, 'utf8').digest('hex'),
      `${f}: committed manifest checksum must equal the raw-byte digest`
    )
  }
})

test('checkManifest reports drift, absence and ordering violations', () => {
  const manifest = buildManifest()
  assert.deepEqual(checkManifest(manifest), [])
  assert.ok(checkManifest({ files: manifest.files.slice(1) })[0].includes(manifest.files[0].file))
  const tampered = manifest.files.map(f => ({ ...f }))
  tampered[0] = { ...tampered[0], sha256: '0'.repeat(64) }
  assert.ok(checkManifest({ files: tampered })[0].includes('checksum drift'))
  const reversed = { files: [...manifest.files].reverse() }
  assert.ok(checkManifest(reversed).some(p => p.includes('order')))
})

test('the proposals directory is not part of the applied artifact', () => {
  // docs/proposals/027_*.sql is a seed *proposal*, never a migration; the
  // manifest must not name it and the migrations directory must not contain
  // a 027 file.
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  assert.ok(!manifest.files.some(f => f.file.includes('027')))
  assert.ok(!fs.readdirSync(migrationsDir).some(f => f.startsWith('027_')))
})
