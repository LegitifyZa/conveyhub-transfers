import { createRequire } from 'node:module'
import { Socket } from 'node:net'

const require = createRequire(import.meta.url)
const dsns = [
  'TEST_DATABASE_URL', 'TEST_MIGRATION_DATABASE_URL', 'SPECIALIST_TEST_DATABASE_URL',
  'DATABASE_URL', 'POSTGRES_URL', 'POSTGRES_URL_NON_POOLING',
  'ConveyHub_Transfers_POSTGRES_URL', 'ConveyHub_Transfers_POSTGRES_URL_NON_POOLING',
]
for (const name of dsns) {
  if (process.env[name]) throw new Error(`Offline tests require an empty ${name}`)
}
for (const [name, value] of Object.entries(process.env)) {
  if (/^RUN_.*(?:DB_TESTS|MIGRATION_CHAIN_TESTS)$/.test(name) && value === '1') {
    throw new Error(`Offline tests refuse database opt-in ${name}`)
  }
}

const dotenv = require('dotenv')
dotenv.config = dotenv.configDotenv = () => ({ parsed: {} })
require('pg').Client.prototype.connect = function () {
  throw new Error('PostgreSQL connections are disabled in offline tests')
}

const connect = Socket.prototype.connect
Socket.prototype.connect = function (...args) {
  const options = Array.isArray(args[0]) ? args[0][0] : args[0]
  const host = typeof options === 'object'
    ? options?.host ?? options?.hostname ?? 'localhost'
    : typeof args[1] === 'string' ? args[1] : 'localhost'
  if (options?.path || (typeof options === 'string' && !/^\d+$/.test(options))
    || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new Error('External and IPC sockets are disabled in offline tests')
  }
  return connect.apply(this, args)
}
