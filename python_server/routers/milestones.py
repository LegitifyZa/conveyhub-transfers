from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from db import query, with_transaction
from utils.validate import is_non_empty_string, to_date_string

router = APIRouter()

VALID_MILESTONE_STATUSES = ["not_started", "in_progress", "completed", "overdue", "not_required"]


def map_milestone_row(row):
    return {
        "id": row["id"],
        "matterId": row["matter_id"],
        "definitionId": row["definition_id"],
        "name": row["name"],
        "statusLabel": row["status_label"],
        "status": row["status"],
        "sequenceNumber": row["sequence_number"],
        "dueDate": row["due_date"],
        "completedDate": row["completed_date"],
        "notes": row["notes"],
        "assignedTo": row["assigned_to"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def map_audit_row(row):
    return {
        "id": row["id"],
        "milestoneId": row["milestone_id"],
        "user": row["actor_name"] or row["changed_by"],
        "action": row["action"],
        "timestamp": row["created_at"],
    }


async def resolve_matter_id_for_transfer(id: str):
    from utils.validate import is_uuid
    transfer_result = await query(
        f"SELECT id FROM transfers WHERE transfer_id = $1{' OR id = $1::uuid' if is_uuid(id) else ''}",
        [id],
    )
    if not transfer_result.rows:
        return None
    transfer_uuid = transfer_result.rows[0]["id"]

    matter_result = await query(
        "SELECT id FROM matters WHERE source_record_id = $1 AND matter_type = 'transfer' LIMIT 1",
        [transfer_uuid],
    )
    if matter_result.rows:
        return matter_result.rows[0]["id"]

    fallback_result = await query(
        "SELECT matter_id FROM transfers WHERE id = $1",
        [transfer_uuid],
    )
    return fallback_result.rows[0]["matter_id"] if fallback_result.rows else None


async def update_single_milestone(conn, matter_id: str, milestone_id: str, payload: dict):
    status = payload.get("status")
    due_date = payload.get("dueDate")
    completed_date = payload.get("completedDate")
    notes = payload.get("notes")
    actor_name = payload.get("actorName")

    current_result = await query(
        "SELECT * FROM matter_milestones WHERE id = $1 AND matter_id = $2",
        [milestone_id, matter_id],
        connection=conn,
    )
    if not current_result.rows:
        exc = Exception("Milestone not found")
        exc.status_code = 404
        raise exc
    current = current_result.rows[0]

    updates = []
    params = []
    param_idx = 1

    if isinstance(status, str) and status in VALID_MILESTONE_STATUSES:
        updates.append(f"status = ${param_idx}")
        params.append(status)
        param_idx += 1

    due = to_date_string(due_date)
    if due is not None:
        updates.append(f"due_date = ${param_idx}")
        params.append(due)
        param_idx += 1

    completed = to_date_string(completed_date)
    if completed is not None:
        updates.append(f"completed_date = ${param_idx}")
        params.append(completed)
        param_idx += 1

    if isinstance(notes, str):
        updates.append(f"notes = ${param_idx}")
        params.append(notes)
        param_idx += 1

    if not updates:
        return {"milestone": map_milestone_row(current), "audit": False}

    updates.append("updated_at = CURRENT_TIMESTAMP")
    params.append(milestone_id)
    params.append(matter_id)
    updated_result = await query(
        f"UPDATE matter_milestones SET {', '.join(updates)} WHERE id = ${param_idx} AND matter_id = ${param_idx + 1} RETURNING *",
        params,
        connection=conn,
    )
    updated_row = updated_result.rows[0]

    summary_parts = []
    if current["status"] != updated_row["status"]:
        summary_parts.append(f"status: {current['status']} -> {updated_row['status']}")
    if str(current["due_date"]) != str(updated_row["due_date"]):
        summary_parts.append("due date changed")
    if current["notes"] != updated_row["notes"]:
        summary_parts.append("notes updated")

    await query(
        """INSERT INTO milestone_history (
          milestone_id, changed_by, actor_name, action, old_status, new_status,
          old_due_date, new_due_date, old_notes, new_notes, change_summary
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)""",
        [
            milestone_id,
            None,
            actor_name if is_non_empty_string(actor_name) else "System",
            ", ".join(summary_parts) if summary_parts else "Updated",
            current["status"],
            updated_row["status"],
            current["due_date"],
            updated_row["due_date"],
            current["notes"],
            updated_row["notes"],
            "; ".join(summary_parts) or "Milestone updated",
        ],
        connection=conn,
    )

    return {"milestone": map_milestone_row(updated_row), "audit": True}


async def sync_transfer_progress_from_milestones(conn, matter_id: str):
    matter_result = await query(
        "SELECT source_record_id FROM matters WHERE id = $1",
        [matter_id],
        connection=conn,
    )
    transfer_id = matter_result.rows[0]["source_record_id"] if matter_result.rows else None
    if not transfer_id:
        return

    stats = await query(
        """SELECT
          COUNT(*) FILTER (WHERE status = 'completed') AS completed,
          COUNT(*) FILTER (WHERE status != 'not_required') AS total_required
         FROM matter_milestones
         WHERE matter_id = $1""",
        [matter_id],
        connection=conn,
    )
    completed = int(stats.rows[0]["completed"] or 0)
    total_required = int(stats.rows[0]["total_required"] or 0)
    if total_required == 0:
        return

    progress = round((completed / total_required) * 100)
    await query(
        """UPDATE transfers
         SET progress = $1,
             status = CASE WHEN $2 = 100 AND status != 'completed' THEN 'completed' ELSE status END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3""",
        [progress, progress, transfer_id],
        connection=conn,
    )


@router.get("/transfers/{transfer_id}/milestones")
async def get_milestones(transfer_id: str):
    matter_id = await resolve_matter_id_for_transfer(transfer_id)
    if not matter_id:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "Transfer or associated matter not found"},
        )

    result = await query(
        """SELECT * FROM matter_milestones
           WHERE matter_id = $1
           ORDER BY sequence_number, created_at""",
        [matter_id],
    )
    return {"success": True, "data": [map_milestone_row(row) for row in result.rows]}


@router.patch("/transfers/{transfer_id}/milestones/{milestone_id}")
async def patch_milestone(transfer_id: str, milestone_id: str, body: dict):
    matter_id = await resolve_matter_id_for_transfer(transfer_id)
    if not matter_id:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "Transfer or associated matter not found"},
        )

    async def _update(conn):
        result = await update_single_milestone(conn, matter_id, milestone_id, body)
        await sync_transfer_progress_from_milestones(conn, matter_id)
        return result["milestone"]

    updated = await with_transaction(_update)
    return {"success": True, "data": updated, "message": "Milestone updated successfully"}


@router.put("/transfers/{transfer_id}/milestones")
async def put_milestones(transfer_id: str, body: list = Body(default_factory=list)):
    if body is None:
        body = []
    matter_id = await resolve_matter_id_for_transfer(transfer_id)
    if not matter_id:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "Transfer or associated matter not found"},
        )

    milestones = body if isinstance(body, list) else [body]

    async def _update(conn):
        results = []
        for raw in milestones:
            item = raw if isinstance(raw, dict) else {}
            id = item.get("id")
            if not is_non_empty_string(id):
                continue
            result = await update_single_milestone(conn, matter_id, id, item)
            results.append(result["milestone"])
        await sync_transfer_progress_from_milestones(conn, matter_id)
        return results

    updated = await with_transaction(_update)
    return {"success": True, "data": updated, "message": "Milestones updated successfully"}


@router.get("/transfers/{transfer_id}/milestones/{milestone_id}/audit")
async def get_milestone_audit(transfer_id: str, milestone_id: str):
    matter_id = await resolve_matter_id_for_transfer(transfer_id)
    if not matter_id:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "Transfer or associated matter not found"},
        )

    milestone_result = await query(
        "SELECT id FROM matter_milestones WHERE id = $1 AND matter_id = $2",
        [milestone_id, matter_id],
    )
    if not milestone_result.rows:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "Milestone not found"},
        )

    result = await query(
        """SELECT * FROM milestone_history
           WHERE milestone_id = $1
           ORDER BY created_at DESC""",
        [milestone_id],
    )
    return {"success": True, "data": [map_audit_row(row) for row in result.rows]}


@router.get("/transfers/{transfer_id}/activity")
async def get_transfer_activity(transfer_id: str):
    matter_id = await resolve_matter_id_for_transfer(transfer_id)
    if not matter_id:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "Transfer or associated matter not found"},
        )

    result = await query(
        """SELECT mh.* FROM milestone_history mh
           JOIN matter_milestones mm ON mh.milestone_id = mm.id
           WHERE mm.matter_id = $1
           ORDER BY mh.created_at DESC""",
        [matter_id],
    )
    return {"success": True, "data": [map_audit_row(row) for row in result.rows]}
