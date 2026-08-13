import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from db import query, with_transaction
from utils.validate import is_non_empty_string

router = APIRouter()

VALID_MODULES = ["Transfers", "Bonds", "Cancellations", "General"]
VALID_STATUSES = ["Active", "Draft", "Retired"]


def map_catalogue_row(row):
    return {
        "id": row["id"],
        "catalogueCode": row["catalogue_code"],
        "name": row["name"],
        "module": row["module"],
        "matterType": row["matter_type"],
        "status": row["status"],
        "legalAuthority": row["legal_authority"] or "",
        "version": row["current_version"],
        "template": row["template_file_name"] or "",
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


@router.get("/")
async def list_catalogue(request: Request):
    module = request.query_params.get("module")
    status = request.query_params.get("status")
    search = request.query_params.get("search")

    conditions = []
    params = []
    param_idx = 1

    if is_non_empty_string(module):
        conditions.append(f"module = ${param_idx}")
        params.append(module)
        param_idx += 1

    if is_non_empty_string(status) and status in VALID_STATUSES:
        conditions.append(f"status = ${param_idx}")
        params.append(status)
        param_idx += 1

    if is_non_empty_string(search):
        conditions.append(f"(name ILIKE ${param_idx} OR catalogue_code ILIKE ${param_idx} OR matter_type ILIKE ${param_idx})")
        params.append(f"%{search}%")
        param_idx += 1

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    result = await query(
        f"SELECT * FROM document_catalogue {where_clause} ORDER BY module, name",
        params,
    )
    return [map_catalogue_row(row) for row in result.rows]


@router.get("/{id}")
async def get_catalogue(id: str):
    catalogue_result = await query(
        "SELECT * FROM document_catalogue WHERE id = $1 OR catalogue_code = $1",
        [id],
    )
    if not catalogue_result.rows:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "Catalogue document not found"},
        )

    row = catalogue_result.rows[0]
    fields_result, requirements_result = await query(
        """SELECT f.field_key
           FROM document_catalogue_fields cdf
           JOIN template_data_fields f ON cdf.data_field_id = f.id
           WHERE cdf.catalogue_document_id = $1""",
        [row["id"]],
    ), await query(
        """SELECT supporting_document_name
           FROM document_catalogue_requirements
           WHERE catalogue_document_id = $1
           ORDER BY sequence_number""",
        [row["id"]],
    )

    result = map_catalogue_row(row)
    result["requiredDataFields"] = [f["field_key"] for f in fields_result.rows]
    result["requiredSupportingDocuments"] = [r["supporting_document_name"] for r in requirements_result.rows]
    return result


@router.post("/")
async def create_catalogue(body: dict):
    name = body.get("name")
    module = body.get("module")
    matter_type = body.get("matterType")
    status = body.get("status")
    legal_authority = body.get("legalAuthority")
    version = body.get("version")
    template = body.get("template")
    required_data_fields = body.get("requiredDataFields")
    required_supporting_documents = body.get("requiredSupportingDocuments")

    if not is_non_empty_string(name) or not is_non_empty_string(module) or module not in VALID_MODULES:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "name and a valid module are required"},
        )

    async def _create(conn):
        catalogue_code = f"CAT-{str(int(time.time() * 1000))[-6:]}"
        catalogue_status = status if is_non_empty_string(status) and status in VALID_STATUSES else "Draft"
        catalogue_version = version if is_non_empty_string(version) else "1.0"

        catalogue_result = await query(
            """INSERT INTO document_catalogue (
              catalogue_code, name, module, matter_type, status, legal_authority, current_version, template_file_name
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *""",
            [
                catalogue_code,
                name,
                module,
                matter_type if is_non_empty_string(matter_type) else "General Conveyancing",
                catalogue_status,
                legal_authority if is_non_empty_string(legal_authority) else None,
                catalogue_version,
                template if is_non_empty_string(template) else None,
            ],
            connection=conn,
        )
        catalogue_id = catalogue_result.rows[0]["id"]

        template_identifier = f"{module.lower()}-{name.lower().replace(' ', '-')}"
        await query(
            """INSERT INTO document_templates (catalogue_document_id, name, identifier, status)
             VALUES ($1, $2, $3, $4)""",
            [catalogue_id, name, template_identifier, catalogue_status],
            connection=conn,
        )

        if isinstance(required_data_fields, list):
            for field_key in required_data_fields:
                if not is_non_empty_string(field_key):
                    continue
                field_result = await query(
                    """INSERT INTO template_data_fields (field_key, label, entity_name, data_type, description)
                     VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (field_key) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
                     RETURNING id""",
                    [field_key, field_key, "General", "Text", "Auto-created from catalogue"],
                    connection=conn,
                )
                await query(
                    """INSERT INTO document_catalogue_fields (catalogue_document_id, data_field_id, is_required)
                     VALUES ($1, $2, TRUE)
                     ON CONFLICT (catalogue_document_id, data_field_id) DO NOTHING""",
                    [catalogue_id, field_result.rows[0]["id"]],
                    connection=conn,
                )

        if isinstance(required_supporting_documents, list):
            sequence = 1
            for doc_name in required_supporting_documents:
                if not is_non_empty_string(doc_name):
                    continue
                await query(
                    """INSERT INTO document_catalogue_requirements (catalogue_document_id, supporting_document_name, sequence_number)
                     VALUES ($1, $2, $3)""",
                    [catalogue_id, doc_name, sequence],
                    connection=conn,
                )
                sequence += 1

        return catalogue_result.rows[0]

    created = await with_transaction(_create)
    return JSONResponse(status_code=201, content={"success": True, "data": map_catalogue_row(created)})
