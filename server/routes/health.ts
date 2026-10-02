import { Router, Request, Response } from 'express'
import { checkDatabaseHealth, getPoolStats, query } from '../db'
import { checkReadiness } from '../readiness'
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
// no hostnames, DSNs or driver error payloads.
router.get(
  '/ready',
  asyncHandler(async (_req: Request, res: Response) => {
    const configValid = validateStartupConfig(process.env).length === 0
    const result = await checkReadiness({ query, configValid })
    res.status(result.ready ? 200 : 503).json({
      status: result.ready ? 'ready' : 'not-ready',
      checks: result.checks,
      timestamp: new Date().toISOString(),
    })
  }),
)

export default router
