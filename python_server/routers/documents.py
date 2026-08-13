from fastapi import APIRouter, Request

from db import query

router = APIRouter()


def map_document_row(row):
    return {
        "id": row["id"],
        "transferId": row["transfer_id"],
        "name": row["name"],
        "category": row["category"],
        "status": row["status"],
        "filePath": row["file_path"],
        "fileSize": row["file_size"],
        "fileType": row["file_type"],
        "description": row["description"],
        "uploadedBy": row["uploaded_by"],
        "uploadedAt": row["uploaded_at"],
        "updatedAt": row["updated_at"],
        "transferReference": row["transfer_reference"],
        "buyerName": row["buyer_name"],
    }


@router.get("/")
async def list_documents(request: Request):
    search = request.query_params.get("search", "")
    limit = min(100, max(1, int(request.query_params.get("limit", "50") or 50)))
    offset = max(0, int(request.query_params.get("offset", "0") or 0))

    sql = """
      SELECT d.*,
             t.transfer_id AS transfer_reference,
             (SELECT p.name FROM parties p WHERE p.transfer_id = d.transfer_id AND p.type = 'buyer' LIMIT 1) AS buyer_name
      FROM documents d
      LEFT JOIN transfers t ON t.id = d.transfer_id
    """
    params = []

    if search:
        sql += " WHERE d.name ILIKE $1 OR d.category ILIKE $1"
        params.append(f"%{search}%")

    sql += " ORDER BY d.uploaded_at DESC NULLS LAST LIMIT $" + str(len(params) + 1) + " OFFSET $" + str(len(params) + 2)
    params.extend([limit, offset])

    result = await query(sql, params)

    if search:
        count_sql = "SELECT COUNT(*) FROM documents WHERE name ILIKE $1 OR category ILIKE $1"
        count_params = [f"%{search}%"]
    else:
        count_sql = "SELECT COUNT(*) FROM documents"
        count_params = []
    count_result = await query(count_sql, count_params)
    total = int(count_result.rows[0]["count"])

    return {
        "success": True,
        "data": [map_document_row(row) for row in result.rows],
        "total": total,
    }
