import { Router, Request, Response } from 'express'
import { requireJwt } from '../../auth/requireJwt'
import { asyncHandler } from '../../utils/asyncHandler'

const router = Router()

const DEEDLY_UNAVAILABLE = { success: false, error: 'Golden Record service unavailable' }

// Auth-forwarding BFF proxy for the FastAPI DEEDLY service. The caller's JWT is
// verified here by requireJwt, then forwarded unchanged so FastAPI
// independently re-verifies it and derives the accountable institution from
// the token itself. This route adds no trust: it never issues tokens, never
// synthesises claims, and never attaches the platform X-Service-Key — that key
// is only ever applied by python_server's own EntitiesClient upstream.
router.post(
  '/search',
  requireJwt,
  asyncHandler(async (req: Request, res: Response) => {
    const baseUrl = process.env.DEEDLY_API_BASE_URL
    if (!baseUrl) {
      res.status(503).json(DEEDLY_UNAVAILABLE)
      return
    }

    let upstream: globalThis.Response
    try {
      upstream = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/v1/golden-records/search`, {
        method: 'POST',
        headers: {
          Authorization: req.headers.authorization as string,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(req.body ?? {}),
      })
    } catch {
      res.status(503).json(DEEDLY_UNAVAILABLE)
      return
    }

    const contentType = upstream.headers.get('content-type')
    if (contentType) {
      res.setHeader('Content-Type', contentType)
    }
    res.status(upstream.status).send(await upstream.text())
  })
)

export default router
