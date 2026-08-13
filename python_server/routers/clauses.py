from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from db import query, with_transaction
from utils.validate import is_non_empty_string, is_uuid, to_date_string

router = APIRouter()

VALID_CLAUSE_STATUS = ["Active", "Draft", "Retired"]


def _format_effective_date(value):
    if not value:
        return ""
    if hasattr(value, "isoformat"):
        return value.isoformat().split("T")[0]
    return str(value)


def map_flattened_clause(row):
    return {
        "id": row["version_id"],
        "identifier": row["identifier"],
        "name": row["name"],
        "category": row["category"],
        "version": row["version"],
        "status": row["status"],
        "legalAuthority": row["legal_authority"] or "",
        "effectiveDate": _format_effective_date(row["effective_date"]),
        "content": row["content"],
        "createdAt": row["created_at"],
        "updatedAt": row["created_at"],
    }


async def fetch_clause_versions(where_clause: str, params: list, connection=None):
    result = await query(
        """SELECT
           c.id as clause_id,
           c.identifier,
           c.name,
           c.category,
           cv.id as version_id,
           cv.version,
           cv.status,
           cv.legal_authority,
           cv.effective_date,
           cv.content,
           cv.created_at
         FROM clauses c
         JOIN clause_versions cv ON c.id = cv.clause_id
         {where}
         ORDER BY c.identifier, cv.version DESC""".format(where=where_clause),
        params,
        connection=connection,
    )
    return result.rows


def pick_active_version(rows):
    active = [r for r in rows if r["status"] == "Active"]
    return active[0] if active else (rows[0] if rows else None)


@router.get("/")
async def list_clauses(request: Request):
    category = request.query_params.get("category")
    status = request.query_params.get("status")
    search = request.query_params.get("search")

    conditions = []
    params = []
    param_idx = 1

    if is_non_empty_string(category):
        conditions.append(f"c.category = ${param_idx}")
        params.append(category)
        param_idx += 1

    if is_non_empty_string(status) and status in VALID_CLAUSE_STATUS:
        conditions.append(f"cv.status = ${param_idx}")
        params.append(status)
        param_idx += 1

    if is_non_empty_string(search):
        conditions.append(
            f"(c.identifier ILIKE ${param_idx} OR c.name ILIKE ${param_idx} OR c.category ILIKE ${param_idx} OR cv.content ILIKE ${param_idx})"
        )
        params.append(f"%{search}%")
        param_idx += 1

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    rows = await fetch_clause_versions(where_clause, params)

    grouped = {}
    for row in rows:
        grouped.setdefault(row["clause_id"], []).append(row)

    flattened = []
    for versions in grouped.values():
        picked = pick_active_version(versions)
        if picked is not None:
            flattened.append(picked)

    flattened.sort(key=lambda row: row["identifier"])
    return [map_flattened_clause(row) for row in flattened]


@router.get("/{id}")
async def get_clause(id: str):
    rows = await fetch_clause_versions(
        "WHERE cv.id = $1::uuid OR c.id = $1::uuid" if is_uuid(id) else "WHERE c.identifier = $1",
        [id],
    )
    if not rows:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "Clause not found"},
        )
    return map_flattened_clause(pick_active_version(rows) or rows[0])


@router.get("/{id}/versions")
async def get_clause_versions(id: str):
    rows = await fetch_clause_versions(
        f"WHERE c.identifier = $1{' OR c.id = $1::uuid' if is_uuid(id) else ''}",
        [id],
    )
    if not rows:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "Clause not found"},
        )
    return [map_flattened_clause(row) for row in rows]


@router.post("/")
async def create_clause(body: dict):
    identifier = body.get("identifier")
    name = body.get("name")
    category = body.get("category")
    version = body.get("version")
    status = body.get("status")
    legal_authority = body.get("legalAuthority")
    effective_date = body.get("effectiveDate")
    content = body.get("content")

    if not is_non_empty_string(identifier) or not is_non_empty_string(name) or not is_non_empty_string(category) or not is_non_empty_string(content):
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "identifier, name, category, and content are required"},
        )

    clause_status = status if is_non_empty_string(status) and status in VALID_CLAUSE_STATUS else "Draft"
    clause_version = version if is_non_empty_string(version) else "1.0"
    effective = to_date_string(effective_date)

    async def _create(conn):
        clause_result = await query(
            """INSERT INTO clauses (identifier, name, category)
             VALUES ($1, $2, $3)
             ON CONFLICT (identifier) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category
             RETURNING *""",
            [identifier.strip().lower(), name, category],
            connection=conn,
        )
        clause_id = clause_result.rows[0]["id"]

        version_result = await query(
            """INSERT INTO clause_versions (clause_id, version, status, legal_authority, effective_date, content)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *""",
            [clause_id, clause_version, clause_status, legal_authority if is_non_empty_string(legal_authority) else None, effective or None, content],
            connection=conn,
        )
        return {"clause": clause_result.rows[0], "version": version_result.rows[0]}

    created = await with_transaction(_create)

    return JSONResponse(
        status_code=201,
        content=map_flattened_clause({
            "clause_id": created["clause"]["id"],
            "identifier": created["clause"]["identifier"],
            "name": created["clause"]["name"],
            "category": created["clause"]["category"],
            "version_id": created["version"]["id"],
            "version": created["version"]["version"],
            "status": created["version"]["status"],
            "legal_authority": created["version"]["legal_authority"],
            "effective_date": created["version"]["effective_date"],
            "content": created["version"]["content"],
            "created_at": created["version"]["created_at"],
        }),
    )


@router.put("/{id}")
async def update_clause(id: str, body: dict):
    clause_result = await query(
        f"SELECT id, identifier, name, category FROM clauses WHERE identifier = $1{' OR id = $1::uuid' if is_uuid(id) else ''}",
        [id],
    )
    if not clause_result.rows:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "Clause not found"},
        )
    clause_id = clause_result.rows[0]["id"]

    name = body.get("name")
    category = body.get("category")
    version = body.get("version")
    status = body.get("status")
    legal_authority = body.get("legalAuthority")
    effective_date = body.get("effectiveDate")
    content = body.get("content")

    async def _update(conn):
        if is_non_empty_string(name) or is_non_empty_string(category):
            await query(
                "UPDATE clauses SET name = COALESCE($1, name), category = COALESCE($2, category), updated_at = CURRENT_TIMESTAMP WHERE id = $3",
                [name if is_non_empty_string(name) else None, category if is_non_empty_string(category) else None, clause_id],
                connection=conn,
            )

        version_row = None
        if is_non_empty_string(content) or is_non_empty_string(version):
            if is_non_empty_string(version):
                next_version = version
            else:
                max_result = await query(
                    "SELECT version FROM clause_versions WHERE clause_id = $1 ORDER BY version DESC LIMIT 1",
                    [clause_id],
                    connection=conn,
                )
                current = max_result.rows[0]["version"] if max_result.rows else "0.0"
                parts = [int(p or 0) for p in current.split(".")]
                parts[-1] += 1
                next_version = ".".join(str(p) for p in parts)

            version_result = await query(
                """INSERT INTO clause_versions (clause_id, version, status, legal_authority, effective_date, content)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING *""",
                [
                    clause_id,
                    next_version,
                    status if is_non_empty_string(status) and status in VALID_CLAUSE_STATUS else "Draft",
                    legal_authority if is_non_empty_string(legal_authority) else None,
                    to_date_string(effective_date) or None,
                    content if is_non_empty_string(content) else "",
                ],
                connection=conn,
            )
            version_row = version_result.rows[0]
        else:
            latest_result = await query(
                "SELECT * FROM clause_versions WHERE clause_id = $1 ORDER BY created_at DESC LIMIT 1",
                [clause_id],
                connection=conn,
            )
            version_row = latest_result.rows[0]

        clause = await query("SELECT * FROM clauses WHERE id = $1", [clause_id], connection=conn)
        return {"clause": clause.rows[0], "version": version_row}

    updated = await with_transaction(_update)

    return map_flattened_clause({
        "clause_id": updated["clause"]["id"],
        "identifier": updated["clause"]["identifier"],
        "name": updated["clause"]["name"],
        "category": updated["clause"]["category"],
        "version_id": updated["version"]["id"],
        "version": updated["version"]["version"],
        "status": updated["version"]["status"],
        "legal_authority": updated["version"]["legal_authority"],
        "effective_date": updated["version"]["effective_date"],
        "content": updated["version"]["content"],
        "created_at": updated["version"]["created_at"],
    })


@router.delete("/{id}")
async def delete_clause(id: str):
    result = await query(
        f"DELETE FROM clauses WHERE identifier = $1{' OR id = $1::uuid' if is_uuid(id) else ''}",
        [id],
    )
    if (result.row_count or 0) == 0:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "Clause not found"},
        )
    return {"success": True, "data": True, "message": "Clause deleted successfully"}
