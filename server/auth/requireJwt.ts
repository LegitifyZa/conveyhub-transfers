import { Request, Response, NextFunction } from 'express'
import { verifyJwt } from './jwt'
import { CurrentUser } from './currentUser'

function parseBearer(header: string): [string, string] {
  const idx = header.indexOf(' ')
  if (idx === -1) {
    return [header.trim(), '']
  }
  return [header.slice(0, idx).trim(), header.slice(idx + 1).trim()]
}

export function quarantineLegacyRoute(req: Request, res: Response): void {
  requireJwt(req, res, () => {
    res.status(503).json({ success: false, error: 'Legacy endpoint unavailable' })
  })
}

export function requireJwt(req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store')
  const authHeader = req.headers.authorization
  const jwtSecret = process.env.JWT_SECRET

  if (!authHeader) {
    res.status(401).json({ success: false, error: 'Authentication required' })
    return
  }

  const [scheme, token] = parseBearer(authHeader)
  if (scheme.toLowerCase() !== 'bearer' || !token) {
    res.status(401).json({ success: false, error: 'Authentication required' })
    return
  }

  try {
    req.currentUser = verifyJwt(token, jwtSecret)
    next()
    return
  } catch {
    res.status(401).json({ success: false, error: 'Authentication required' })
    return
  }
}
