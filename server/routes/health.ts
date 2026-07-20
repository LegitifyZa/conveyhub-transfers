import { Router, Request, Response } from 'express'
import { checkDatabaseHealth, getPoolStats } from '../db'
import { asyncHandler } from '../utils/asyncHandler'

const router = Router()

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
  })
)

export default router
