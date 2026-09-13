import { Router, Request, Response } from 'express'
import { requireJwt } from '../../auth/requireJwt'
import { asyncHandler } from '../../utils/asyncHandler'

const router = Router()

const DEEDLY_UNAVAILABLE = { success: false, error: 'Golden Record service unavailable' }
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Auth-forwarding BFF proxy for the FastAPI DEEDLY service. The caller's JWT is
// verified here by requireJwt, then forwarded unchanged so FastAPI
// independently re-verifies it and derives the accountable institution from
// the token itself. This route adds no trust: it never issues tokens, never
// synthesises claims, and never attaches the platform X-Service-Key — that key
// is only ever applied by python_server's own EntitiesClient upstream.
async function proxyGoldenRecord(req: Request, res: Response, path: string, method: 'GET' | 'POST') {
  const baseUrl = process.env.DEEDLY_API_BASE_URL
  if (!baseUrl) {
    res.status(503).json(DEEDLY_UNAVAILABLE)
    return
  }

  try {
    const upstream = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/v1/golden-records/${path}`, {
      method,
      headers: {
        Authorization: req.headers.authorization as string,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: JSON.stringify(req.body ?? {}) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(35_000),
    })
    const body = await upstream.text()
    if (upstream.status >= 500) {
      res.status(503).json(DEEDLY_UNAVAILABLE)
      return
    }
    const contentType = upstream.headers.get('content-type')
    if (contentType) {
      res.setHeader('Content-Type', contentType)
    }
    res.status(upstream.status).send(body)
  } catch {
    res.status(503).json(DEEDLY_UNAVAILABLE)
  }
}

router.post('/search', requireJwt, asyncHandler((req, res) => proxyGoldenRecord(req, res, 'search', 'POST')))

router.get(
  '/:goldenRecordId',
  requireJwt,
  asyncHandler(async (req: Request, res: Response) => {
    res.setHeader('Cache-Control', 'no-store')
    const { goldenRecordId } = req.params
    const entityType = req.query.entity_type
    if (!UUID_PATTERN.test(goldenRecordId) || Object.keys(req.query).length !== 1
      || typeof entityType !== 'string' || !['person', 'company', 'trust'].includes(entityType)) {
      res.status(422).json({ success: false, error: 'Invalid Golden Record reference' })
      return
    }
    await proxyGoldenRecord(req, res, `${goldenRecordId.toLowerCase()}?entity_type=${entityType}`, 'GET')
  })
)

export default router
