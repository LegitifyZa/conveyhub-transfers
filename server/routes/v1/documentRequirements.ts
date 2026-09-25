import { Router, Request, Response } from 'express'
import { requireJwt } from '../../auth/requireJwt'
import { asyncHandler } from '../../utils/asyncHandler'

const router = Router({ mergeParams: true })

const SERVICE_UNAVAILABLE = { success: false, error: 'Document Requirements service unavailable' }
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function proxyToFastApi(req: Request, res: Response, subpath: string, method: 'GET' | 'POST') {
  const baseUrl = process.env.DEEDLY_API_BASE_URL
  if (!baseUrl) {
    res.status(503).json(SERVICE_UNAVAILABLE)
    return
  }

  try {
    const upstreamUrl = `${baseUrl.replace(/\/+$/, '')}/api/v1/${subpath}`
    const upstream = await fetch(upstreamUrl, {
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
      res.status(503).json(SERVICE_UNAVAILABLE)
      return
    }

    const contentType = upstream.headers.get('content-type')
    if (contentType) {
      res.setHeader('Content-Type', contentType)
    }
    res.status(upstream.status).send(body)
  } catch {
    res.status(503).json(SERVICE_UNAVAILABLE)
  }
}

// GET /api/v1/matters/:matterId/document-requirements
router.get(
  '/:matterId/document-requirements',
  requireJwt,
  asyncHandler(async (req: Request, res: Response) => {
    const { matterId } = req.params
    if (!UUID_PATTERN.test(matterId)) {
      res.status(422).json({ success: false, error: 'Invalid matter ID' })
      return
    }
    await proxyToFastApi(req, res, `matters/${matterId}/document-requirements`, 'GET')
  })
)

// POST /api/v1/matters/:matterId/document-requirements/evaluate
router.post(
  '/:matterId/document-requirements/evaluate',
  requireJwt,
  asyncHandler(async (req: Request, res: Response) => {
    const { matterId } = req.params
    if (!UUID_PATTERN.test(matterId)) {
      res.status(422).json({ success: false, error: 'Invalid matter ID' })
      return
    }
    await proxyToFastApi(req, res, `matters/${matterId}/document-requirements/evaluate`, 'POST')
  })
)

// POST /api/v1/matters/:matterId/document-requirements/adhoc
router.post(
  '/:matterId/document-requirements/adhoc',
  requireJwt,
  asyncHandler(async (req: Request, res: Response) => {
    const { matterId } = req.params
    if (!UUID_PATTERN.test(matterId)) {
      res.status(422).json({ success: false, error: 'Invalid matter ID' })
      return
    }
    await proxyToFastApi(req, res, `matters/${matterId}/document-requirements/adhoc`, 'POST')
  })
)

// POST /api/v1/matters/:matterId/document-requirements/:requirementId/upload
router.post(
  '/:matterId/document-requirements/:requirementId/upload',
  requireJwt,
  asyncHandler(async (req: Request, res: Response) => {
    const { matterId, requirementId } = req.params
    if (!UUID_PATTERN.test(matterId) || !UUID_PATTERN.test(requirementId)) {
      res.status(422).json({ success: false, error: 'Invalid identifier' })
      return
    }
    await proxyToFastApi(req, res, `matters/${matterId}/document-requirements/${requirementId}/upload`, 'POST')
  })
)

// POST /api/v1/matters/:matterId/document-requirements/:requirementId/review
router.post(
  '/:matterId/document-requirements/:requirementId/review',
  requireJwt,
  asyncHandler(async (req: Request, res: Response) => {
    const { matterId, requirementId } = req.params
    if (!UUID_PATTERN.test(matterId) || !UUID_PATTERN.test(requirementId)) {
      res.status(422).json({ success: false, error: 'Invalid identifier' })
      return
    }
    await proxyToFastApi(req, res, `matters/${matterId}/document-requirements/${requirementId}/review`, 'POST')
  })
)

// POST /api/v1/matters/:matterId/document-requirements/:requirementId/satisfy-generation
router.post(
  '/:matterId/document-requirements/:requirementId/satisfy-generation',
  requireJwt,
  asyncHandler(async (req: Request, res: Response) => {
    const { matterId, requirementId } = req.params
    if (!UUID_PATTERN.test(matterId) || !UUID_PATTERN.test(requirementId)) {
      res.status(422).json({ success: false, error: 'Invalid identifier' })
      return
    }
    await proxyToFastApi(req, res, `matters/${matterId}/document-requirements/${requirementId}/satisfy-generation`, 'POST')
  })
)

// GET /api/v1/matters/:matterId/document-requirements/:requirementId/download
router.get(
  '/:matterId/document-requirements/:requirementId/download',
  requireJwt,
  asyncHandler(async (req: Request, res: Response) => {
    const { matterId, requirementId } = req.params
    if (!UUID_PATTERN.test(matterId) || !UUID_PATTERN.test(requirementId)) {
      res.status(422).json({ success: false, error: 'Invalid identifier' })
      return
    }
    await proxyToFastApi(req, res, `matters/${matterId}/document-requirements/${requirementId}/download`, 'GET')
  })
)

export default router
