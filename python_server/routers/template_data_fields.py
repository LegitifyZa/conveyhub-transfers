from fastapi import APIRouter, Request

from db import query
from utils.validate import is_non_empty_string

router = APIRouter()


def map_field_row(row):
    return {
        "id": row["id"],
        "key": row["field_key"],
        "label": row["label"],
        "entity": row["entity_name"],
        "dataType": row["data_type"],
        "description": row["description"],
        "isActive": row["is_active"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


@router.get("/")
async def list_data_fields(request: Request):
    entity = request.query_params.get("entity")
    search = request.query_params.get("search")

    conditions = []
    params = []
    param_idx = 1

    if is_non_empty_string(entity):
        conditions.append(f"entity_name = ${param_idx}")
        params.append(entity)
        param_idx += 1

    if is_non_empty_string(search):
        conditions.append(f"(field_key ILIKE ${param_idx} OR label ILIKE ${param_idx} OR description ILIKE ${param_idx})")
        params.append(f"%{search}%")
        param_idx += 1

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    result = await query(
        f"SELECT * FROM template_data_fields {where_clause} ORDER BY entity_name, field_key",
        params,
    )
    return [map_field_row(row) for row in result.rows]
