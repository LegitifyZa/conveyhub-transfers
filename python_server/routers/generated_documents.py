import json
from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from db import query, with_transaction
from utils.validate import is_non_empty_string, is_uuid

router = APIRouter()


def map_generated_document_list(row):
    input_data = row["generation_input"] or {}
    if isinstance(input_data, str):
        try:
            input_data = json.loads(input_data)
        except (ValueError, TypeError):
            input_data = {}
    return {
        "id": row["id"],
        "documentId": row["document_id"],
        "matterId": row["matter_id"],
        "fileName": row["file_name"],
        "templateVersion": input_data.get("templateVersion", ""),
        "clauseVersions": input_data.get("clauseVersions", []),
        "generatedDate": row["generated_at"],
        "generatorVersion": row["generator_version"],
        "format": row["output_format"],
        "actor": row["actor_name"] or row["generated_by"] or "",
    }


async def resolve_matter_id_for_transfer_reference(reference: str):
    transfer_result = await query(
        f"SELECT id FROM transfers WHERE transfer_id = $1{' OR id = $1::uuid' if is_uuid(reference) else ''}",
        [reference],
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

    insert_result = await query(
        """INSERT INTO matters (reference_number, matter_type, title, status, source_record_id)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id""",
        [reference, "transfer", f"Transfer {reference}", "draft", transfer_uuid],
    )
    return insert_result.rows[0]["id"] if insert_result.rows else None


@router.get("/")
async def list_generated_documents(request: Request):
    matter_id = request.query_params.get("matterId")
    transfer_id = request.query_params.get("transferId")
    where = ""
    params = []

    if matter_id:
        where = "WHERE gd.matter_id = $1"
        params.append(matter_id)
    elif transfer_id:
        matter_uuid = await resolve_matter_id_for_transfer_reference(transfer_id)
        if matter_uuid:
            where = "WHERE gd.matter_id = $1"
            params.append(matter_uuid)

    result = await query(
        """SELECT id, document_id, matter_id, file_name, output_format, generator_version, generated_by, actor_name, generated_at
           FROM generated_documents gd
           {where}
           ORDER BY generated_at DESC""".format(where=where),
        params,
    )
    return [map_generated_document_list(row) for row in result.rows]


@router.post("/")
async def create_generated_document(body: dict):
    file_name = body.get("fileName")
    matter_id = body.get("matterId")
    format = body.get("format")

    if not is_non_empty_string(file_name) or not is_non_empty_string(matter_id) or not is_non_empty_string(format):
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "fileName, matterId, and format are required"},
        )

    matter_uuid = await resolve_matter_id_for_transfer_reference(matter_id)
    if not matter_uuid:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "Unable to resolve matter for generated document"},
        )

    async def _create(conn):
        result = await query(
            """INSERT INTO generated_documents (
              document_id, matter_id, file_name, output_format, generator_version,
              resolved_fields, unresolved_fields, undefined_fields, unresolved_clauses, generation_input,
              generated_by, actor_name, generated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *""",
            [
                body.get("documentId") if is_non_empty_string(body.get("documentId")) else None,
                matter_uuid,
                file_name,
                format,
                is_non_empty_string(body.get("generatorVersion")) and body["generatorVersion"] or "1.0.0",
                json.dumps([]),
                json.dumps([]),
                json.dumps([]),
                json.dumps([]),
                json.dumps({
                    "templateVersion": is_non_empty_string(body.get("templateVersion")) and body["templateVersion"] or "",
                    "clauseVersions": body["clauseVersions"] if isinstance(body.get("clauseVersions"), list) else [],
                }),
                is_non_empty_string(body.get("actor")) and is_uuid(body["actor"]) and body["actor"] or None,
                is_non_empty_string(body.get("actor")) and body["actor"] or None,
                is_non_empty_string(body.get("generatedDate")) and body["generatedDate"] or datetime.now(timezone.utc).isoformat(),
            ],
            connection=conn,
        )
        return result.rows[0]

    created = await with_transaction(_create)
    return JSONResponse(status_code=201, content={"success": True, "data": map_generated_document_list(created)})


@router.get("/{id}")
async def get_generated_document(id: str):
    result = await query("SELECT * FROM generated_documents WHERE id = $1", [id])
    if not result.rows:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "Generated document not found"},
        )

    row = result.rows[0]
    clauses_result = await query(
        """SELECT cv.id, cv.version, c.identifier as clause_identifier, c.name as clause_name, gdc.sequence_number
           FROM generated_document_clauses gdc
           JOIN clause_versions cv ON gdc.clause_version_id = cv.id
           JOIN clauses c ON cv.clause_id = c.id
           WHERE gdc.generated_document_id = $1
           ORDER BY gdc.sequence_number""",
        [id],
    )

    generation_input = row["generation_input"] or {}
    if isinstance(generation_input, str):
        try:
            generation_input = json.loads(generation_input)
        except (ValueError, TypeError):
            generation_input = {}

    return {
        "id": row["id"],
        "documentId": row["document_id"],
        "matterId": row["matter_id"],
        "fileName": row["file_name"],
        "outputFormat": row["output_format"],
        "generatorVersion": row["generator_version"],
        "resolvedContent": row["resolved_content"],
        "resolvedFields": row["resolved_fields"],
        "unresolvedFields": row["unresolved_fields"],
        "undefinedFields": row["undefined_fields"],
        "unresolvedClauses": row["unresolved_clauses"],
        "generationInput": generation_input,
        "generatedBy": row["generated_by"],
        "actorName": row["actor_name"],
        "generatedAt": row["generated_at"],
        "clauses": [{
            "id": r["id"],
            "identifier": r["clause_identifier"],
            "name": r["clause_name"],
            "version": r["version"],
            "sequenceNumber": r["sequence_number"],
        } for r in clauses_result.rows],
    }
