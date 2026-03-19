import { db } from '../database'
import { User } from '../types'

export class UserService {
  // Get user by email
  static async getUserByEmail(email: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE email = $1'
    const result = await db.query(query, [email])
    return result.rows[0] || null
  }

  // Get user by ID
  static async getUserById(id: string): Promise<User | null> {
    const query = 'SELECT * FROM users WHERE id = $1'
    const result = await db.query(query, [id])
    return result.rows[0] || null
  }

  // Create new user
  static async createUser(data: {
    email: string
    name: string
    role?: 'admin' | 'user' | 'conveyancer'
  }): Promise<User> {
    const query = `
      INSERT INTO users (email, name, role)
      VALUES ($1, $2, $3)
      RETURNING *
    `
    const result = await db.query(query, [data.email, data.name, data.role || 'user'])
    return result.rows[0]
  }

  // Update user
  static async updateUser(id: string, data: {
    name?: string
    role?: 'admin' | 'user' | 'conveyancer'
  }): Promise<User | null> {
    const updates: string[] = []
    const params: any[] = []
    let paramIndex = 1

    Object.entries(data).forEach(([key, value]) => {
      if (value !== undefined) {
        updates.push(`${key} = $${paramIndex}`)
        params.push(value)
        paramIndex++
      }
    })

    if (updates.length === 0) {
      return await this.getUserById(id)
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`)
    params.push(id)

    const query = `
      UPDATE users 
      SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `

    const result = await db.query(query, params)
    return result.rows[0] || null
  }

  // Delete user
  static async deleteUser(id: string): Promise<boolean> {
    const query = 'DELETE FROM users WHERE id = $1'
    const result = await db.query(query, [id])
    return result.rowCount > 0
  }

  // Get all users
  static async getAllUsers(): Promise<User[]> {
    const query = 'SELECT * FROM users ORDER BY created_at DESC'
    const result = await db.query(query)
    return result.rows
  }
}
