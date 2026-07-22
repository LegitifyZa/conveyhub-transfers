import { Router, Request, Response } from 'express'
import { query } from '../db'
import { asyncHandler } from '../utils/asyncHandler'

const router = Router()

function mapUserRow(row: any) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    firstName: row.first_name,
    lastName: row.last_name,
    phone: row.phone,
    avatarUrl: row.avatar_url,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

router.get(
  '/me',
  asyncHandler(async (_req: Request, res: Response) => {
    const result = await query(
      `SELECT * FROM users WHERE status = 'active' ORDER BY created_at ASC, id ASC LIMIT 1`
    )

    if (result.rows.length === 0) {
      res.status(404).json({ success: false, error: 'No user found' })
      return
    }

    res.json({ success: true, data: mapUserRow(result.rows[0]) })
  })
)

router.put(
  '/me',
  asyncHandler(async (req: Request, res: Response) => {
    const { firstName, lastName, email, phone } = req.body as {
      firstName?: unknown
      lastName?: unknown
      email?: unknown
      phone?: unknown
    }

    const getResult = await query(
      `SELECT * FROM users WHERE status = 'active' ORDER BY created_at ASC, id ASC LIMIT 1`
    )

    if (getResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'No user found' })
      return
    }

    const user = getResult.rows[0]
    const updatedFirstName = typeof firstName === 'string' ? firstName.trim() : user.first_name || ''
    const updatedLastName = typeof lastName === 'string' ? lastName.trim() : user.last_name || ''
    const updatedEmail = typeof email === 'string' ? email.trim() : user.email
    const updatedPhone = typeof phone === 'string' ? phone.trim() : user.phone || ''
    const updatedName = `${updatedFirstName} ${updatedLastName}`.trim() || user.name

    if (!updatedEmail) {
      res.status(400).json({ success: false, error: 'Email is required' })
      return
    }

    const existingEmail = await query(
      'SELECT id FROM users WHERE email = $1 AND id != $2 LIMIT 1',
      [updatedEmail, user.id]
    )

    if (existingEmail.rows.length > 0) {
      res.status(409).json({ success: false, error: 'Email already in use' })
      return
    }

    const result = await query(
      `UPDATE users
       SET first_name = $1, last_name = $2, email = $3, phone = $4, name = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
      [updatedFirstName, updatedLastName, updatedEmail, updatedPhone, updatedName, user.id]
    )

    res.json({ success: true, data: mapUserRow(result.rows[0]), message: 'Profile updated' })
  })
)

export default router
