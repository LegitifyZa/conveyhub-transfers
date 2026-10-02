// Self-contained TLS fixtures for db-tls regression tests.
//
// Generates a throwaway CA plus two server certificates (DNS:localhost and
// DNS:not-localhost.test) with the local openssl binary into a temp dir —
// no live credentials or production material. `haveOpenssl()` lets callers
// skip cleanly when the toolchain is absent.
//
// startTlsServer() speaks the Postgres SSLRequest negotiation (8-byte probe,
// 'S' reply, TLS upgrade) so clients exercise their real ssl code path.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import tls from 'node:tls'

export function haveOpenssl() {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function openssl(args) {
  return execFileSync('openssl', args, { stdio: ['ignore', 'pipe', 'pipe'] })
}

export function generateTestCerts(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-tls-fixture-'))) {
  const caKey = path.join(dir, 'ca-key.pem')
  const ca = path.join(dir, 'ca.pem')
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-keyout', caKey, '-out', ca,
    '-days', '2', '-nodes', '-subj', '/CN=deedly-tls-test-ca'])
  const mk = (cn, san, out, key, csr) => {
    openssl(['req', '-newkey', 'rsa:2048', '-keyout', key, '-out', csr,
      '-nodes', '-subj', `/CN=${cn}`])
    const ext = path.join(dir, `${cn}-san.cnf`)
    fs.writeFileSync(ext, `subjectAltName=${san}\n`)
    openssl(['x509', '-req', '-in', csr, '-CA', ca, '-CAkey', caKey,
      '-CAcreateserial', '-out', out, '-days', '2', '-extfile', ext])
  }
  mk('localhost', 'DNS:localhost', path.join(dir, 'srv.pem'), path.join(dir, 'srv-key.pem'), path.join(dir, 'srv.csr'))
  mk('not-localhost.test', 'DNS:not-localhost.test', path.join(dir, 'srv-bad.pem'), path.join(dir, 'srv-bad-key.pem'), path.join(dir, 'srv-bad.csr'))
  // A second, unrelated CA — the "untrusted" trust anchor for negatives.
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-keyout', path.join(dir, 'bogus-ca-key.pem'),
    '-out', path.join(dir, 'bogus-ca.pem'), '-days', '2', '-nodes', '-subj', '/CN=unrelated-ca'])
  return {
    dir,
    ca,
    bogusCa: path.join(dir, 'bogus-ca.pem'),
    good: { cert: path.join(dir, 'srv.pem'), key: path.join(dir, 'srv-key.pem') },
    badName: { cert: path.join(dir, 'srv-bad.pem'), key: path.join(dir, 'srv-bad-key.pem') },
  }
}

// Accepts `limit` connections, then exits the accept loop. events records
// 'secureConnection' / 'tlsClientError:…' / 'nonSSLRequest' per attempt.
export async function startTlsServer({ cert, key, limit = 8 }) {
  const secureContext = tls.createSecureContext({
    cert: fs.readFileSync(cert),
    key: fs.readFileSync(key),
  })
  const events = []
  let seen = 0
  const server = net.createServer((raw) => {
    if (++seen > limit) return raw.destroy()
    raw.once('data', (buf) => {
      if (buf.length >= 8 && buf.readUInt32BE(4) === 80877103) {
        raw.write('S')
        const t = new tls.TLSSocket(raw, { isServer: true, secureContext })
        t.on('secure', () => { events.push('secureConnection'); t.destroy() })
        t.on('error', (e) => events.push('tlsClientError:' + (e.code || e.message)))
      } else {
        events.push('nonSSLRequest')
        raw.destroy()
      }
    })
    raw.on('error', () => {})
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { port: server.address().port, events, close: () => server.close() }
}
