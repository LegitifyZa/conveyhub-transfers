import { Request, Response, NextFunction } from 'express'
import { verifyJwt } from './jwt'
import { verifyServiceKey } from './serviceKey'
import { CurrentUser } from './currentUser'

declare global {
  namespace Express {
    interface Request {
      currentUser?: CurrentUser
      serviceAuth?: boolean
    }
  }
}

function parseBearer(header: string): [string, string] {
  const idx = header.indexOf(' ')
  if (idx === -1) {
    return [header.trim(), '']
  }
  return [header.slice(0, idx).trim(), header.slice(idx + 1).trim()]
}

export function requireJwtOrServiceKey(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization
  const serviceKey = req.headers['x-service-key'] as string | undefined
  const secret = process.env.SECRET_KEY || ''
  const jwtSecret = process.env.JWT_SECRET

  if (serviceKey) {
    try {
      verifyServiceKey(serviceKey, secret)
      req.serviceAuth = true
      next()
      return
    } catch {
      res.status(401).json({ success: false, error: 'Authentication required' })
      return
    }
  }

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

export function requireAbility(ability: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.serviceAuth) {
      res.status(403).json({ success: false, error: 'Forbidden' })
      return
    }

    const user = req.currentUser
    if (!user) {
      res.status(401).json({ success: false, error: 'Authentication required' })
      return
    }

    if (user.hasAbility(ability)) {
      next()
      return
    }

    res.status(403).json({ success: false, error: 'Forbidden' })
    return
  }
}
