// Runtime assets the compiled BFF (dist/server/) needs but tsc does not
// emit: the shared .mjs TLS resolver and the approved migration manifest
// that /api/health/ready validates the schema ledger against.
//
//   server/db.ts        imports ../scripts/db-tls.mjs
//   server/readiness.ts reads   ../src/lib/migrations/manifest.json
//
// rootDir=".." maps server/*.ts → dist/server/server/*.js, so the runtime
// targets are dist/server/scripts/ and dist/server/src/lib/migrations/.

import fs from 'node:fs'
import path from 'node:path'

const ASSETS = [
  ['scripts/db-tls.mjs', 'dist/server/scripts/db-tls.mjs'],
  ['src/lib/migrations/manifest.json', 'dist/server/src/lib/migrations/manifest.json'],
]

for (const [src, dest] of ASSETS) {
  if (!fs.existsSync(src)) {
    console.error(`copy-server-assets: missing source ${src}`)
    process.exit(1)
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  console.log(`copy-server-assets: ${src} -> ${dest}`)
}
