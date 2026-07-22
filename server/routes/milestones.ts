import { Router, Request, Response } from 'express'
import { query, withTransaction } from '../db'
import { asyncHandler } from '../utils/asyncHandler'
import { isNonEmptyString, toDateString } from '../utils/validate'

const router = Router()

const VALID_MILESTONE_STATUSES = ['not_started', 'in_progress', 'completed', 'overdue', 'not_required']
const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

function mapMilestoneRow(row: any) {
  return {
    id: row.id,
    matterId: row.matter_id,
    definitionId: row.definition_id,
    name: row.name,
    statusLabel: row.status_label,
    status: row.status,
    sequenceNumber: row.sequence_number,
    dueDate: row.due_date,
    completedDate: row.completed_date,
    notes: row.notes,
    assignedTo: row.assigned_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapAuditRow(row: any) {
  return {
    id: row.id,
    milestoneId: row.milestone_id,
    user: row.actor_name || row.changed_by,
    action: row.action,
    timestamp: row.created_at,
  }
}

async function resolveMatterIdForTransfer(id: string): Promise<string | null> {
  const transferResult = await query<{ id: string }>(
    `SELECT id FROM transfers WHERE transfer_id = $1${isUuid(id) ? ' OR id = $1::uuid' : ''}`,
    [id]
  )
  if (transferResult.rows.length === 0) return null
  const transferUuid = transferResult.rows[0].id

  const matterResult = await query<{ id: string }>(
    `SELECT id FROM matters WHERE source_record_id = $1 AND matter_type = 'transfer' LIMIT 1`,
    [transferUuid]
  )
  if (matterResult.rows[0]) return matterResult.rows[0].id

  const fallbackResult = await query<{ matter_id: string }>(
    'SELECT matter_id FROM transfers WHERE id = $1',
    [transferUuid]
  )
  return fallbackResult.rows[0]?.matter_id ?? null
}

router.get(
  '/transfers/:transferId/milestones',
  asyncHandler(async (req: Request, res: Response) => {
    const { transferId } = req.params
    const matterId = await resolveMatterIdForTransfer(transferId)
    if (!matterId) {
      res.status(404).json({ success: false, error: 'Transfer or associated matter not found' })
      return
    }

    const result = await query(
      `SELECT * FROM matter_milestones
       WHERE matter_id = $1
       ORDER BY sequence_number, created_at`,
      [matterId]
    )
    res.json({ success: true, data: result.rows.map(mapMilestoneRow) })
  })
)

async function updateSingleMilestone(
  client: import('pg').PoolClient,
  matterId: string,
  milestoneId: string,
  payload: Record<string, unknown>
): Promise<{ milestone: any; audit: boolean }> {
  const { status, dueDate, completedDate, notes, actorName } = payload

  const currentResult = await client.query(
    'SELECT * FROM matter_milestones WHERE id = $1 AND matter_id = $2',
    [milestoneId, matterId]
  )
  if (currentResult.rows.length === 0) {
    throw Object.assign(new Error('Milestone not found'), { statusCode: 404 })
  }
  const current = currentResult.rows[0]

  const updates: string[] = []
  const params: unknown[] = []
  let paramIdx = 1

  if (typeof status === 'string' && VALID_MILESTONE_STATUSES.includes(status)) {
    updates.push(`status = $${paramIdx}`)
    params.push(status)
    paramIdx += 1
  }

  const due = toDateString(dueDate)
  if (due !== undefined) {
    updates.push(`due_date = $${paramIdx}`)
    params.push(due)
    paramIdx += 1
  }

  const completed = toDateString(completedDate)
  if (completed !== undefined) {
    updates.push(`completed_date = $${paramIdx}`)
    params.push(completed)
    paramIdx += 1
  }

  if (typeof notes === 'string') {
    updates.push(`notes = $${paramIdx}`)
    params.push(notes)
    paramIdx += 1
  }

  if (updates.length === 0) {
    return { milestone: mapMilestoneRow(current), audit: false }
  }

  updates.push(`updated_at = CURRENT_TIMESTAMP`)
  params.push(milestoneId)
  const updatedResult = await client.query(
    `UPDATE matter_milestones SET ${updates.join(', ')} WHERE id = $${paramIdx} AND matter_id = $${paramIdx + 1} RETURNING *`,
    [...params, matterId]
  )
  const updatedRow = updatedResult.rows[0]

  const summaryParts: string[] = []
  if (current.status !== updatedRow.status) summaryParts.push(`status: ${current.status} -> ${updatedRow.status}`)
  if (String(current.due_date) !== String(updatedRow.due_date)) summaryParts.push('due date changed')
  if (current.notes !== updatedRow.notes) summaryParts.push('notes updated')

  await client.query(
    `INSERT INTO milestone_history (
      milestone_id, changed_by, actor_name, action, old_status, new_status,
      old_due_date, new_due_date, old_notes, new_notes, change_summary
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      milestoneId,
      null,
      isNonEmptyString(actorName) ? actorName : 'System',
      summaryParts.length > 0 ? summaryParts.join(', ') : 'Updated',
      current.status,
      updatedRow.status,
      current.due_date,
      updatedRow.due_date,
      current.notes,
      updatedRow.notes,
      summaryParts.join('; ') || 'Milestone updated',
    ]
  )

  return { milestone: mapMilestoneRow(updatedRow), audit: true }
}

async function syncTransferProgressFromMilestones(
  client: import('pg').PoolClient,
  matterId: string
) {
  const matterResult = await client.query<{ source_record_id: string }>(
    'SELECT source_record_id FROM matters WHERE id = $1',
    [matterId]
  )
  const transferId = matterResult.rows[0]?.source_record_id
  if (!transferId) return

  const stats = await client.query<{
    completed: string
    total_required: string
  }>(
    `SELECT
      COUNT(*) FILTER (WHERE status = 'completed') AS completed,
      COUNT(*) FILTER (WHERE status != 'not_required') AS total_required
     FROM matter_milestones
     WHERE matter_id = $1`,
    [matterId]
  )

  const completed = parseInt(stats.rows[0]?.completed || '0', 10)
  const totalRequired = parseInt(stats.rows[0]?.total_required || '0', 10)
  if (totalRequired === 0) return

  const progress = Math.round((completed / totalRequired) * 100)
  await client.query(
    `UPDATE transfers
     SET progress = $1,
         status = CASE WHEN $2 = 100 AND status != 'completed' THEN 'completed' ELSE status END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $3`,
    [progress, progress, transferId]
  )
}

router.patch(
  '/transfers/:transferId/milestones/:milestoneId',
  asyncHandler(async (req: Request, res: Response) => {
    const { transferId, milestoneId } = req.params
    const matterId = await resolveMatterIdForTransfer(transferId)
    if (!matterId) {
      res.status(404).json({ success: false, error: 'Transfer or associated matter not found' })
      return
    }

    const updated = await withTransaction(async (client) => {
      const { milestone } = await updateSingleMilestone(client, matterId, milestoneId, req.body as Record<string, unknown>)
      await syncTransferProgressFromMilestones(client, matterId)
      return milestone
    })

    res.json({ success: true, data: updated, message: 'Milestone updated successfully' })
  })
)

router.put(
  '/transfers/:transferId/milestones',
  asyncHandler(async (req: Request, res: Response) => {
    const { transferId } = req.params
    const matterId = await resolveMatterIdForTransfer(transferId)
    if (!matterId) {
      res.status(404).json({ success: false, error: 'Transfer or associated matter not found' })
      return
    }

    const milestones = Array.isArray(req.body) ? req.body : [req.body]
    const updated = await withTransaction(async (client) => {
      const results: any[] = []
      for (const raw of milestones) {
        const item = raw as Record<string, unknown>
        const id = isNonEmptyString(item.id) ? item.id : undefined
        if (!id) continue
        const { milestone } = await updateSingleMilestone(client, matterId, id, item)
        results.push(milestone)
      }
      await syncTransferProgressFromMilestones(client, matterId)
      return results
    })

    res.json({ success: true, data: updated, message: 'Milestones updated successfully' })
  })
)

router.get(
  '/transfers/:transferId/milestones/:milestoneId/audit',
  asyncHandler(async (req: Request, res: Response) => {
    const { transferId, milestoneId } = req.params
    const matterId = await resolveMatterIdForTransfer(transferId)
    if (!matterId) {
      res.status(404).json({ success: false, error: 'Transfer or associated matter not found' })
      return
    }

    const milestoneResult = await query(
      'SELECT id FROM matter_milestones WHERE id = $1 AND matter_id = $2',
      [milestoneId, matterId]
    )
    if (milestoneResult.rows.length === 0) {
      res.status(404).json({ success: false, error: 'Milestone not found' })
      return
    }

    const result = await query(
      `SELECT * FROM milestone_history
       WHERE milestone_id = $1
       ORDER BY created_at DESC`,
      [milestoneId]
    )
    res.json({ success: true, data: result.rows.map(mapAuditRow) })
  })
)

router.get(
  '/transfers/:transferId/activity',
  asyncHandler(async (req: Request, res: Response) => {
    const { transferId } = req.params
    const matterId = await resolveMatterIdForTransfer(transferId)
    if (!matterId) {
      res.status(404).json({ success: false, error: 'Transfer or associated matter not found' })
      return
    }

    const result = await query(
      `SELECT mh.* FROM milestone_history mh
       JOIN matter_milestones mm ON mh.milestone_id = mm.id
       WHERE mm.matter_id = $1
       ORDER BY mh.created_at DESC`,
      [matterId]
    )
    res.json({ success: true, data: result.rows.map(mapAuditRow) })
  })
)

export default router
