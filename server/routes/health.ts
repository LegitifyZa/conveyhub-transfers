import { Router, Request, Response } from 'express'
import { checkDatabaseHealth, getPoolStats, makeProbeQuery } from '../db'
import { checkReadiness, singleFlight } from '../readiness'
import { validateStartupConfig } from '../startupConfig'
import { asyncHandler } from '../utils/asyncHandler'

const router = Router()

// Back-compat aggregate check (kept for existing dashboards).
router.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const dbHealth = await checkDatabaseHealth()
    res.status(dbHealth.healthy ? 200 : 503).json({
      status: dbHealth.healthy ? 'ok' : 'error',
      db: {
        healthy: dbHealth.healthy,
        latencyMs: dbHealth.latencyMs,
        error: dbHealth.error,
      },
      pool: getPoolStats(),
      timestamp: new Date().toISOString(),
    })
  }),
)

// Liveness: process is up. No dependency checks — a dead dependency must
// not stop the orchestrator from reaching this endpoint.
router.get('/live', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Readiness: bounded, read-only dependency + schema checks. Labels only —
// no hostnames, DSNs or driver error payloads. Single-flight: overlapping
// requests share one in-flight probe; nothing is cached between probes.
const readinessProbe = singleFlight(() =>
  checkReadiness({
    // Dedicated probe client — see makeProbeQuery for why pool.query is
    // not used (query_timeout does not cancel the backend statement).
    query: makeProbeQuery(),
    configValid: validateStartupConfig(process.env).length === 0,
    // v1 proxy routes are served by FastAPI — a configured upstream is an
    // essential dependency for the pilot workflow.
    upstreamBaseUrl: process.env.DEEDLY_API_BASE_URL?.replace(/\/+$/, ''),
  }),
)

router.get(
  '/ready',
  asyncHandler(async (_req: Request, res: Response) => {
    const result = await readinessProbe()
    res.status(result.ready ? 200 : 503).json({
      status: result.ready ? 'ready' : 'not-ready',
      checks: result.checks,
      timestamp: new Date().toISOString(),
    })
  }),
)

export default router
