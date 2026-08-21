import crypto from 'crypto'

export class ServiceKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ServiceKeyError'
  }
}

export function verifyServiceKey(header: string | undefined, secret: string): void {
  if (!secret) {
    throw new ServiceKeyError('Service key not configured')
  }
  if (!header) {
    throw new ServiceKeyError('Service key required')
  }

  const h = Buffer.from(header)
  const s = Buffer.from(secret)

  if (h.length !== s.length) {
    throw new ServiceKeyError('Invalid service key')
  }

  if (!crypto.timingSafeEqual(h, s)) {
    throw new ServiceKeyError('Invalid service key')
  }
}
