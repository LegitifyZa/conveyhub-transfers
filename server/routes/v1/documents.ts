import { Router, Request, Response } from 'express'
import { Readable } from 'stream'
import { requireJwt } from '../../auth/requireJwt'
import { asyncHandler } from '../../utils/asyncHandler'

const router = Router()

const DEEDLY_UNAVAILABLE = { success: false, error: 'Document service temporarily unavailable' }

// Download proxy. The opaque token in the path scopes the grant (document,
// institution, expiry) but is not sufficient on its own: the caller's JWT is
// verified here and forwarded upstream, where the FastAPI lane re-authorizes
// institution + ability and re-checks the document's still-clean state.
router.get(
  '/download/:token',
  requireJwt,
  asyncHandler(async (req: Request, res: Response) => {
    const baseUrl = process.env.DEEDLY_API_BASE_URL
    if (!baseUrl) {
      res.status(503).json(DEEDLY_UNAVAILABLE)
      return
    }
    try {
      const upstream = await fetch(
        `${baseUrl.replace(/\/+$/, '')}/api/v1/documents/download/${encodeURIComponent(req.params.token)}`,
        {
          method: 'GET',
          headers: { Authorization: req.headers.authorization as string },
          redirect: 'error',
          signal: AbortSignal.timeout(120_000),
        }
      )
      if (upstream.status >= 500) {
        res.status(503).json(DEEDLY_UNAVAILABLE)
        return
      }
      res.status(upstream.status)
      for (const header of ['content-type', 'content-disposition', 'cache-control']) {
        const value = upstream.headers.get(header)
        if (value) {
          res.setHeader(header, value)
        }
      }
      if (!upstream.body) {
        res.end()
        return
      }
      Readable.fromWeb(upstream.body as import('stream/web').ReadableStream).pipe(res)
    } catch {
      res.status(503).json(DEEDLY_UNAVAILABLE)
    }
  })
)

export default router
