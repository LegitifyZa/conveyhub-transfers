import assert from 'node:assert/strict'
import { createServer, Server } from 'node:http'
import { after, before, describe, it } from 'node:test'

import express from 'express'

// URL-encoded body-parser contract for the qs remediation (issue #7,
// Workstream B): express 4.22.3 + body-parser 1.20.8 + qs 6.16.0.
// The app is rebuilt here with the same middleware options as
// server/index.ts (extended: true) so the assertions pin parser behaviour,
// not route wiring.

const app = express()
app.use(express.urlencoded({ extended: true }))
app.post('/echo', (req, res) => res.json(req.body))

let server: Server
let baseUrl: string

before(async () => {
  server = createServer(app)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (typeof address === 'object' && address) baseUrl = `http://127.0.0.1:${address.port}`
})

after(() => server.close())

async function postForm(body: string) {
  const res = await fetch(`${baseUrl}/echo`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

describe('qs urlencoded parser contract', () => {
  it('parses nested keys in extended mode', async () => {
    const { status, body } = await postForm('a[b][c]=1')
    assert.equal(status, 200)
    assert.deepEqual(body, { a: { b: { c: '1' } } })
  })

  it('does not pollute Object.prototype via __proto__ keys', async () => {
    const { status } = await postForm('__proto__[polluted]=yes&a[__proto__][x]=1')
    assert.equal(status, 200)
    assert.equal(({} as Record<string, unknown>).polluted, undefined)
    assert.equal((Object.prototype as Record<string, unknown>).polluted, undefined)
  })

  it('parses bracket arrays and indexed arrays', async () => {
    const { body } = await postForm('a[]=1&a[]=2&b[0]=x&b[1]=y')
    assert.deepEqual(body.a, ['1', '2'])
    assert.deepEqual(body.b, ['x', 'y'])
  })

  it('does not split comma values (comma:false) — bracket/comma array-limit bypass is closed', async () => {
    const { body } = await postForm('a[]=1,2,3')
    assert.deepEqual(body.a, ['1,2,3'])
  })

  it('enforces the parameter limit', async () => {
    const body = Array.from({ length: 1001 }, (_, i) => `k${i}=v`).join('&')
    const { status } = await postForm(body)
    assert.equal(status, 413)
  })

  it('deeply nested keys parse to a deterministic bounded object', async () => {
    const { status, body } = await postForm('a[b][c][d][e][f][g]=1')
    assert.equal(status, 200)
    assert.deepEqual(body, { a: { b: { c: { d: { e: { f: { g: '1' } } } } } } })
  })

  it('indexed keys below the limit compact to dense sorted arrays', async () => {
    const { body } = await postForm('a[25]=x&a[3]=y')
    assert.deepEqual(body.a, ['y', 'x'])
  })

  it('indexed keys above the limit stay literal objects — no sparse allocation', async () => {
    const { body } = await postForm('a[100000]=x')
    assert.deepEqual(body.a, { '100000': 'x' })
  })

  it('plain querystring behaviour still works for flat keys', async () => {
    const { body } = await postForm('name=DEEDLY&n=3')
    assert.deepEqual(body, { name: 'DEEDLY', n: '3' })
  })
})
