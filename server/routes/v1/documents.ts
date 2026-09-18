import { Router, Request, Response } from 'express'
import { Readable } from 'stream'
import { asyncHandler } from '../../utils/asyncHandler'

const router = Router()

const DEEDLY_UNAVAILABLE = { success: false, error: 'Document service temporarily unavailable' }

// Bearer-token download proxy. The opaque token in the path is the credential
// (pre-signed-URL semantics — no JWT here by design); the FastAPI lane
// verifies signature, expiry and the document's still-clean state.
router.get(
  '/download/:token',
  asyncHandler(async (req: Request, res: Response) => {
    const baseUrl = process.env.DEEDLY_API_BASE_URL
    if (!baseUrl) {
      res.status(503).json(DEEDLY_UNAVAILABLE)
      return
    }
    try {
      const upstream = await fetch(
        `${baseUrl.replace(/\/+$/, '')}/api/v1/documents/download/${encodeURIComponent(req.params.token)}`,
        { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(120_000) }
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
