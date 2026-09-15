import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..', '..')
const suitePath = path.join(here, 'v1SpecialistRoutes.test.ts')

describe('specialist suite authorization guard', () => {
  it(
    'opens no database connection and runs no setup or cleanup under ordinary discovery',
    { timeout: 120_000 },
    async () => {
      // Honeypot: the suite's ordinary DB_* configuration is pointed at a local
      // TCP listener that records every connection attempt. If the guard let
      // the app or pool load, the first setup/cleanup query would dial it.
      const connections: net.Socket[] = []
      const honeypot = net.createServer((socket) => {
        connections.push(socket)
        socket.destroy()
      })
      await new Promise<void>((resolve) => honeypot.listen(0, '127.0.0.1', resolve))
      const port = (honeypot.address() as net.AddressInfo).port

      const env: Record<string, string> = {}
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) env[key] = value
      }
      // Strip every authorization and connection-string channel, plus the
      // test-runner recursion marker so the spawned suite genuinely executes.
      delete env.NODE_TEST_CONTEXT
      for (const key of [
        'TEST_DATABASE_URL',
        'RUN_SPECIALIST_DB_TESTS',
        'SPECIALIST_TEST_DATABASE_URL',
        'DATABASE_URL',
        'POSTGRES_URL',
        'POSTGRES_URL_NON_POOLING',
        'ConveyHub_Transfers_POSTGRES_URL',
        'ConveyHub_Transfers_POSTGRES_URL_NON_POOLING',
      ]) {
        delete env[key]
      }
      env.DB_HOST = '127.0.0.1'
      env.DB_PORT = String(port)

      try {
        const { code, output } = await new Promise<{ code: number | null; output: string }>(
          (resolve, reject) => {
            const child = spawn(
              process.execPath,
              ['--import', 'tsx', '--test', suitePath],
              { cwd: repoRoot, env },
            )
            let output = ''
            child.stdout.on('data', (chunk) => (output += chunk))
            child.stderr.on('data', (chunk) => (output += chunk))
            child.on('error', reject)
            child.on('close', (code) => resolve({ code, output }))
          },
        )
        assert.equal(connections.length, 0, 'suite opened a database connection without authorization')
        assert.equal(code, 0, `unauthorized suite should exit cleanly:\n${output}`)
        assert.match(output, /requires TEST_DATABASE_URL plus RUN_SPECIALIST_DB_TESTS=1/)
      } finally {
        honeypot.close()
        for (const socket of connections) socket.destroy()
      }
    },
  )
})
