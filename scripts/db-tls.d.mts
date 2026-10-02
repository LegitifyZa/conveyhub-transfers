// Type declarations for scripts/db-tls.mjs (kept beside the implementation
// so server/ can import the shared M1 TLS resolver).
export interface ResolvedDbTls {
  connectionString: string | null
  ssl: false | { rejectUnauthorized: boolean; ca?: string; checkServerIdentity?: (name: string, cert: object) => Error | undefined }
  enableChannelBinding: boolean | undefined
  warnings: string[]
}

export function resolveDbTls(dsn: string | null, env?: Record<string, string | undefined>): ResolvedDbTls
