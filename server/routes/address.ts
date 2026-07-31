import { Router, Request, Response } from 'express'
import { asyncHandler } from '../utils/asyncHandler'

const router = Router()
const LOQATE_API_KEY = process.env.LOQATE_API_KEY

const LOQATE_FIND_URL = 'https://api.addressy.com/Capture/Interactive/Find/v1.00/json3.ws'
const LOQATE_RETRIEVE_URL = 'https://api.addressy.com/Capture/Interactive/Retrieve/v1.00/json3.ws'

router.get(
  '/search',
  asyncHandler(async (req: Request, res: Response) => {
    if (!LOQATE_API_KEY) {
      res.status(503).json({ success: false, error: 'Loqate API key not configured' })
      return
    }

    const { text, country = 'ZA', limit = '10' } = req.query as {
      text?: string
      country?: string
      limit?: string
    }

    if (!text) {
      res.status(400).json({ success: false, error: 'Address text is required' })
      return
    }

    const params = new URLSearchParams({
      Key: LOQATE_API_KEY,
      Text: text,
      Countries: country,
      Limit: limit,
    })

    const response = await fetch(`${LOQATE_FIND_URL}?${params.toString()}`)
    const data = await response.json()
    res.json({ success: true, data })
  })
)

router.get(
  '/retrieve',
  asyncHandler(async (req: Request, res: Response) => {
    if (!LOQATE_API_KEY) {
      res.status(503).json({ success: false, error: 'Loqate API key not configured' })
      return
    }

    const { id } = req.query as { id?: string }
    if (!id) {
      res.status(400).json({ success: false, error: 'Suggestion id is required' })
      return
    }

    const params = new URLSearchParams({ Key: LOQATE_API_KEY, Id: id })
    const response = await fetch(`${LOQATE_RETRIEVE_URL}?${params.toString()}`)
    const data = await response.json()
    res.json({ success: true, data })
  })
)

router.get(
  '/geocode',
  asyncHandler(async (req: Request, res: Response) => {
    const { q } = req.query as { q?: string }
    if (!q) {
      res.status(400).json({ success: false, error: 'Address query is required' })
      return
    }

    const params = new URLSearchParams({
      format: 'json',
      q,
      limit: '1',
      addressdetails: '1',
    })

    const response = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { 'User-Agent': 'LegitifyConveyHub/1.0 (dev)' },
    })
    const data = await response.json()
    res.json({ success: true, data })
  })
)

export default router
