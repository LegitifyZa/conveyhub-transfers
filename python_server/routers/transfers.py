import base64
import json
import os
import random
import re
import string
import time

from fastapi import APIRouter, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from config import load_settings
from db import query, with_transaction
from utils.validate import is_non_empty_string, is_sa_postal_code, is_uuid, is_valid_transfer_status, to_number

router = APIRouter()

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")

DEFAULT_SORT_COLUMNS = ["created_at", "updated_at", "property_address", "status", "purchase_price"]
VALID_PROPERTY_TYPES = [
    "Freehold", "Sectional Title", "Share Block", "Life Rights",
    "Agricultural Holding", "Farm", "Commercial", "Mixed Use", "Vacant Land",
]


def to_property_type(value):
    if not is_non_empty_string(value):
        return "Freehold"
    for t in VALID_PROPERTY_TYPES:
        if t.lower() == value.lower():
            return t
    return "Freehold"


def n(value, default=0):
    v = to_number(value)
    return v if v is not None else default


def _resolve_parties(value):
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except (ValueError, TypeError):
            return []
    return []


def map_party_row(row):
    return {
        "id": row["id"],
        "transferId": row["transfer_id"],
        "name": row["name"],
        "type": row["type"],
        "idNumber": row["id_number"],
        "registrationNumber": row["registration_number"],
        "email": row["email"],
        "phone": row["phone"],
        "address": row["address"],
        "companyName": row["company_name"],
        "roleTitle": row["role_title"],
        "isPrimary": row["is_primary"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def map_document_row(row):
    return {
        "id": row["id"],
        "transferId": row["transfer_id"],
        "catalogueDocumentId": row.get("catalogue_document_id"),
        "name": row["name"],
        "type": row.get("catalogue_document_id") or row.get("category") or row.get("type"),
        "category": row.get("category"),
        "status": row["status"],
        "filePath": row["file_path"],
        "fileSize": row["file_size"],
        "fileType": row["file_type"],
        "description": row.get("notes") if row.get("notes") is not None else row.get("description"),
        "notes": row.get("notes"),
        "originalFileName": row["original_file_name"],
        "uploadedAt": row["uploaded_at"],
        "updatedAt": row["updated_at"],
    }


def _num(value):
    return to_number(value)


def map_financial_row(row):
    if not row:
        return {}
    return {
        "purchasePrice": _num(row["purchase_price"]),
        "depositAmount": _num(row["deposit_amount"]),
        "loanAmount": _num(row["loan_amount"]),
        "interestRate": _num(row["interest_rate"]),
        "loanTerm": _num(row["loan_term_years"]),
        "transferDuty": _num(row["transfer_duty"]),
        "conveyancingFees": _num(row["conveyancing_fees"]),
        "deedsOfficeFees": _num(row["deeds_office_fees"]),
        "vat": _num(row["vat"]),
        "postAndPetties": _num(row["post_and_petties"]),
        "clearanceCertificateFee": _num(row["clearance_certificate_fee"]),
        "ratesClearanceAmount": _num(row["rates_clearance_amount"]),
        "totalCosts": _num(row["total_costs"]),
        "netProceeds": _num(row["net_proceeds"]),
    }


def map_property_row(row):
    if not row:
        return None
    return {
        "id": row.get("id"),
        "propertyId": row.get("property_id"),
        "erfNumber": row.get("erf_number"),
        "streetAddress": row.get("street_address"),
        "suburb": row.get("suburb"),
        "city": row.get("city"),
        "postalCode": row.get("postal_code"),
        "province": row.get("province"),
        "country": row.get("country"),
        "propertyType": row.get("property_type"),
        "titleDeedNumber": row.get("title_deed_number"),
        "extentSqm": _num(row.get("extent_sqm")),
        "description": row.get("description"),
        "legalDescription": row.get("legal_description"),
        "lotNumber": row.get("lot_number"),
        "yearBuilt": _num(row.get("year_built")),
        "squareFootage": _num(row.get("square_footage")),
        "status": row.get("status"),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
    }


def map_transfer_row(row):
    milestone_progress = row.get("milestone_progress")
    milestone_completed = row.get("milestone_completed")
    parties = row.get("parties", [])
    if isinstance(parties, str):
        try:
            parties = json.loads(parties)
        except (ValueError, TypeError):
            parties = []
    if not isinstance(parties, list):
        parties = []
    return {
        "id": row["id"],
        "transferId": row["transfer_id"],
        "propertyAddress": row["property_address"],
        "purchasePrice": _num(row["purchase_price"]),
        "status": row["status"],
        "currentStep": row["current_step"],
        "totalSteps": row["total_steps"],
        "progress": _num(milestone_progress) if milestone_progress is not None else _num(row["progress"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "nextDueDate": row.get("next_due_date"),
        "parties": [map_party_row(p) for p in parties],
    }


async def generate_unique_transfer_id(conn):
    prefix = "TRF"
    year = time.localtime().tm_year
    for _ in range(10):
        timestamp = str(int(time.time() * 1000))[-6:]
        rand = str(random.randint(0, 999)).zfill(3)
        transfer_id = f"{prefix}-{year}-{timestamp}-{rand}"
        existing = await query(
            "SELECT id FROM transfers WHERE transfer_id = $1",
            [transfer_id],
            connection=conn,
        )
        if not existing.rows:
            return transfer_id
    raise Exception("Failed to generate unique transfer ID")


async def generate_unique_property_id(conn):
    year = time.localtime().tm_year
    for _ in range(10):
        rand = str(random.randint(0, 9999)).zfill(4)
        property_id = f"PROP-{year}-{rand}"
        existing = await query(
            "SELECT id FROM properties WHERE property_id = $1",
            [property_id],
            connection=conn,
        )
        if not existing.rows:
            return property_id
    raise Exception("Failed to generate unique property ID")


async def seed_transfer_documents(conn, transfer_uuid: str):
    existing = await query(
        "SELECT 1 FROM transfer_documents WHERE transfer_id = $1 LIMIT 1",
        [transfer_uuid],
        connection=conn,
    )
    if existing.rows:
        return

    catalogue_result = await query(
        """SELECT id, name, module, matter_type
           FROM document_catalogue
           WHERE status = 'Active' AND module = 'Transfers'
           ORDER BY name""",
        [],
        connection=conn,
    )

    for row in catalogue_result.rows:
        await query(
            """INSERT INTO transfer_documents (transfer_id, catalogue_document_id, name, status)
             VALUES ($1, $2, $3, 'pending')
             ON CONFLICT (transfer_id, catalogue_document_id) DO NOTHING""",
            [transfer_uuid, row["id"], row["name"]],
            connection=conn,
        )


def extension_from_file_name(file_name: str) -> str:
    _, ext = os.path.splitext(file_name)
    return ext.lower() if ext else ".bin"


def sanitise_file_name(file_name: str) -> str:
    name = re.sub(r"[^a-zA-Z0-9_.-]", "_", file_name)
    return re.sub(r"_{2,}", "_", name)


async def save_transfer_document_upload(conn, transfer_uuid, transfer_document_id, file_name, file_type, base64_data):
    match = re.match(r"^data:.*?;base64,(.*)$", base64_data)
    raw_base64 = match.group(1) if match else base64_data

    if not raw_base64:
        raise Exception("Invalid file data")

    try:
        buffer = base64.b64decode(raw_base64)
    except Exception:
        raise Exception("Invalid file data")

    if len(buffer) == 0:
        raise Exception("Empty file")

    safe_name = sanitise_file_name(file_name)
    extension = extension_from_file_name(safe_name)
    upload_dir = os.path.join(UPLOAD_DIR, "transfers", transfer_uuid)
    os.makedirs(upload_dir, exist_ok=True)

    storage_name = f"{int(time.time() * 1000)}-{''.join(random.choices(string.ascii_lowercase + string.digits, k=8))}{extension}"
    file_path = os.path.join(upload_dir, storage_name)
    with open(file_path, "wb") as f:
        f.write(buffer)

    relative_file_path = os.path.relpath(file_path, os.getcwd()).replace("\\", "/")

    result = await query(
        """UPDATE transfer_documents
           SET status = 'uploaded',
               file_path = $1,
               file_size = $2,
               file_type = $3,
               original_file_name = $4,
               uploaded_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $5 AND transfer_id = $6
           RETURNING *""",
        [relative_file_path, len(buffer), file_type, file_name, transfer_document_id, transfer_uuid],
        connection=conn,
    )
    return result.rows[0] if result.rows else None


async def get_or_create_matter_for_transfer(conn, transfer_id, transfer_reference, accountable_institution_id):
    matter_result = await query(
        "SELECT id FROM matters WHERE source_record_id = $1 AND matter_type = $2 LIMIT 1",
        [transfer_id, "transfer"],
        connection=conn,
    )
    if matter_result.rows:
        return matter_result.rows[0]["id"]

    insert_result = await query(
        """INSERT INTO matters (reference_number, matter_type, title, status, source_record_id, accountable_institution_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id""",
        [
            transfer_reference,
            "transfer",
            f"Transfer {transfer_reference}",
            "in_progress",
            transfer_id,
            accountable_institution_id,
        ],
        connection=conn,
    )
    return insert_result.rows[0]["id"]


async def ensure_milestone_definitions(conn):
    count_result = await query("SELECT COUNT(*) FROM milestone_definitions", [], connection=conn)
    if int(count_result.rows[0]["count"]) > 0:
        return

    defaults = [
        {"code": "TRANSFEROR_FICA", "name": "Transferor", "label": "FICA Received", "seq": 1},
        {"code": "TRANSFEREE_FICA", "name": "Transferee", "label": "FICA Received", "seq": 2},
        {"code": "GUARANTEES", "name": "Guarantees", "label": "Guarantee/s Due Date", "seq": 3},
        {"code": "TRANSFER_DUTY", "name": "Transfer Duty", "label": "Applied", "seq": 4},
        {"code": "RATES", "name": "Rates", "label": "Figures Requested", "seq": 5},
        {"code": "LEVIES", "name": "Levies", "label": "Figures Requested", "seq": 6},
        {"code": "HOME_OWNERS", "name": "Home Owners", "label": "Consent Requested", "seq": 7},
        {"code": "ELECTRICAL", "name": "Electrical", "label": "Certificate Requested", "seq": 8},
        {"code": "ENTOMOLOGIST", "name": "Entomologist", "label": "Certificate Requested", "seq": 9},
        {"code": "ELECTRIC_FENCE", "name": "Electric Fence", "label": "Certificate Received", "seq": 10},
        {"code": "GAS_CONFORMITY", "name": "Gas Conformity", "label": "Certificate Requested", "seq": 11},
        {"code": "PLUMBING", "name": "Plumbing", "label": "Certificate Requested", "seq": 12},
        {"code": "INSTRUCTION", "name": "Instruction", "label": "Instruction received", "seq": 13},
        {"code": "DEPOSIT", "name": "Deposit", "label": "Deposit Due", "seq": 14},
        {"code": "NEW_BOND", "name": "New Bond", "label": "Bond Grant Due", "seq": 15},
        {"code": "SUBJECT_TO_SALE", "name": "Subject to Sale", "label": "Due Date", "seq": 16},
        {"code": "SUSPENSIVE_CONDITIONS", "name": "Suspensive Cond's", "label": "All Conditions met", "seq": 17},
        {"code": "BOND_CANCELLATION", "name": "Bond Cancellation", "label": "Figures Requested", "seq": 18},
        {"code": "TITLE_DEED", "name": "Title Deed", "label": "Title Deed Requested", "seq": 19},
        {"code": "TRANSFER_COSTS", "name": "Transfer Costs", "label": "Proforma Sent", "seq": 20},
        {"code": "FICA", "name": "FICA", "label": "Certified", "seq": 21},
        {"code": "POOL", "name": "Pool", "label": "Certificate Requested", "seq": 22},
        {"code": "REGISTRATION_COMPLETE", "name": "Transfer Registration Complete", "label": "5 days after reg", "seq": 23},
    ]

    for defn in defaults:
        await query(
            """INSERT INTO milestone_definitions (code, name, default_status_label, matter_type, sequence_number)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (code) DO NOTHING""",
            [defn["code"], defn["name"], defn["label"], "transfer", defn["seq"]],
            connection=conn,
        )


async def create_default_milestones(conn, matter_id):
    await ensure_milestone_definitions(conn)
    definitions = await query(
        """SELECT id, name, default_status_label, sequence_number FROM milestone_definitions
           WHERE matter_type = $1 AND is_active = TRUE ORDER BY sequence_number""",
        ["transfer"],
        connection=conn,
    )
    for defn in definitions.rows:
        await query(
            """INSERT INTO matter_milestones (matter_id, definition_id, name, status_label, sequence_number, status)
             VALUES ($1, $2, $3, $4, $5, 'not_started')
             ON CONFLICT (matter_id, sequence_number) DO NOTHING""",
            [matter_id, defn["id"], defn["name"], defn["default_status_label"], defn["sequence_number"]],
            connection=conn,
        )


def parse_filters(request: Request):
    page = max(1, int(request.query_params.get("page", "1") or 1))
    limit = min(100, max(1, int(request.query_params.get("limit", "10") or 10)))
    sort_by = request.query_params.get("sortBy", "created_at")
    if sort_by not in DEFAULT_SORT_COLUMNS:
        sort_by = "created_at"
    sort_order = "asc" if str(request.query_params.get("sortOrder", "")).lower() == "asc" else "desc"
    return {
        "status": request.query_params.get("status") if is_non_empty_string(request.query_params.get("status")) else None,
        "search": request.query_params.get("search") if is_non_empty_string(request.query_params.get("search")) else None,
        "page": page,
        "limit": limit,
        "sortBy": sort_by,
        "sortOrder": sort_order,
    }


@router.get("/")
async def list_transfers(request: Request):
    filters = parse_filters(request)
    conditions = []
    params = []
    param_index = 1

    if filters["status"]:
        conditions.append(f"status = ${param_index}")
        params.append(filters["status"])
        param_index += 1

    if filters["search"]:
        conditions.append(f"(property_address ILIKE ${param_index} OR transfer_id ILIKE ${param_index})")
        params.append(f"%{filters['search']}%")
        param_index += 1

    where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    sort_column = filters["sortBy"] if filters["sortBy"] in DEFAULT_SORT_COLUMNS else "created_at"

    count_result = await query(
        f"SELECT COUNT(*) FROM transfers {where_clause}",
        params,
    )
    total = int(count_result.rows[0]["count"])

    offset = (filters["page"] - 1) * filters["limit"]
    data_query = f"""
      SELECT t.id, t.transfer_id, t.property_address, t.purchase_price, t.status, t.current_step, t.total_steps, t.progress, t.created_at, t.updated_at,
        COALESCE((SELECT json_agg(parties.*) FROM parties WHERE parties.transfer_id = t.id), '[]'::json) AS parties,
        (SELECT ROUND(COUNT(*) FILTER (WHERE mm.status = 'completed') * 100.0 / NULLIF(COUNT(*) FILTER (WHERE mm.status != 'not_required'), 0))
         FROM matter_milestones mm
         JOIN matters m ON m.id = mm.matter_id
         WHERE m.source_record_id::uuid = t.id) AS milestone_progress,
        (SELECT COUNT(*) FILTER (WHERE mm.status != 'not_required') > 0
           AND COUNT(*) FILTER (WHERE mm.status = 'completed') = COUNT(*) FILTER (WHERE mm.status != 'not_required')
         FROM matter_milestones mm
         JOIN matters m ON m.id = mm.matter_id
         WHERE m.source_record_id::uuid = t.id) AS milestone_completed,
        (SELECT MIN(mm.due_date) FILTER (WHERE mm.due_date IS NOT NULL AND mm.status NOT IN ('completed', 'not_required'))
         FROM matter_milestones mm
         JOIN matters m ON m.id = mm.matter_id
         WHERE m.source_record_id::uuid = t.id) AS next_due_date
      FROM transfers t
      {where_clause}
      ORDER BY {sort_column} {filters['sortOrder'].upper()}
      LIMIT ${param_index} OFFSET ${param_index + 1}
    """
    data_result = await query(data_query, params + [filters["limit"], offset])

    return {
        "success": True,
        "data": [map_transfer_row(row) for row in data_result.rows],
        "pagination": {
            "page": filters["page"],
            "limit": filters["limit"],
            "total": total,
            "totalPages": -(-total // filters["limit"]),
        },
    }


@router.get("/stats")
async def transfer_stats():
    result = await query("""
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'complete') as complete,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress
      FROM transfers
    """)
    return {"success": True, "data": dict(result.rows[0])}


@router.get("/{id}")
async def get_transfer(id: str):
    transfer_result = await query(
        f"""SELECT t.*, p.id as property_row_id, p.property_id, p.erf_number, p.street_address, p.suburb, p.city,
                p.postal_code, p.province, p.country, p.property_type, p.title_deed_number, p.extent_sqm,
                p.description as property_description, p.legal_description, p.lot_number, p.year_built, p.square_footage,
                p.status as property_status, p.created_at as property_created_at, p.updated_at as property_updated_at,
                (SELECT ROUND(COUNT(*) FILTER (WHERE mm.status = 'completed') * 100.0 / NULLIF(COUNT(*) FILTER (WHERE mm.status != 'not_required'), 0))
                 FROM matter_milestones mm
                 JOIN matters m ON m.id = mm.matter_id
                 WHERE m.source_record_id::uuid = t.id) AS milestone_progress,
                (SELECT COUNT(*) FILTER (WHERE mm.status != 'not_required') > 0
                   AND COUNT(*) FILTER (WHERE mm.status = 'completed') = COUNT(*) FILTER (WHERE mm.status != 'not_required')
                 FROM matter_milestones mm
                 JOIN matters m ON m.id = mm.matter_id
                 WHERE m.source_record_id::uuid = t.id) AS milestone_completed
         FROM transfers t
         LEFT JOIN properties p ON t.property_id = p.id
         WHERE t.transfer_id = $1{' OR t.id = $1::uuid' if is_uuid(id) else ''}""",
        [id],
    )

    if not transfer_result.rows:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "Transfer not found"},
        )

    transfer_row = transfer_result.rows[0]
    transfer_uuid = transfer_row["id"]

    parties_result, documents_result, financials_result = await query(
        "SELECT * FROM parties WHERE transfer_id = $1 ORDER BY type, name",
        [transfer_uuid],
    ), await query(
        """SELECT td.*, dc.catalogue_code, dc.module, dc.matter_type
           FROM transfer_documents td
           LEFT JOIN document_catalogue dc ON dc.id = td.catalogue_document_id
           WHERE td.transfer_id = $1
           ORDER BY td.created_at""",
        [transfer_uuid],
    ), await query(
        "SELECT * FROM transfer_financials WHERE transfer_id = $1",
        [transfer_uuid],
    )

    property_row = {
        "id": transfer_row["property_row_id"],
        "property_id": transfer_row["property_id"],
        "erf_number": transfer_row["erf_number"],
        "street_address": transfer_row["street_address"] or transfer_row["property_address"],
        "suburb": transfer_row["suburb"],
        "city": transfer_row["city"],
        "postal_code": transfer_row["postal_code"],
        "province": transfer_row["province"],
        "country": transfer_row["country"],
        "property_type": transfer_row["property_type"],
        "title_deed_number": transfer_row["title_deed_number"],
        "extent_sqm": transfer_row["extent_sqm"],
        "description": transfer_row["property_description"],
        "legal_description": transfer_row["legal_description"],
        "lot_number": transfer_row["lot_number"],
        "year_built": transfer_row["year_built"],
        "square_footage": transfer_row["square_footage"],
        "status": transfer_row["property_status"],
        "created_at": transfer_row["property_created_at"],
        "updated_at": transfer_row["property_updated_at"],
    }

    return {
        "success": True,
        "data": {
            "id": transfer_row["id"],
            "transferId": transfer_row["transfer_id"],
            "status": transfer_row["status"],
            "currentStep": transfer_row["current_step"],
            "totalSteps": transfer_row["total_steps"],
            "progress": transfer_row["milestone_progress"] if transfer_row["milestone_progress"] is not None else transfer_row["progress"],
            "property": map_property_row(property_row),
            "parties": [map_party_row(row) for row in parties_result.rows],
            "financials": map_financial_row(financials_result.rows[0] if financials_result.rows else None),
            "documents": [map_document_row(row) for row in documents_result.rows],
            "createdAt": transfer_row["created_at"],
            "updatedAt": transfer_row["updated_at"],
        },
    }


@router.post("/")
async def create_transfer(body: dict):
    property_data = body.get("property") or {}
    parties = _resolve_parties(body.get("parties"))
    financials = body.get("financials") or {}
    current_step = body.get("currentStep")
    total_steps = body.get("totalSteps")
    progress = body.get("progress")

    property_address = property_data.get("address") if is_non_empty_string(property_data.get("address")) else None
    purchase_price = n(financials.get("purchasePrice"), n(body.get("purchasePrice"), 0))

    if not property_address:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "Property address is required"},
        )

    # TEMPORARY: the unauthenticated legacy create path is a bridge.  It is
    # controlled entirely by server-side configuration and cannot be overridden
    # by request body values.  Delete once the legacy write path is retired.
    settings = load_settings()
    legacy_ai = settings.legacy_accountable_institution_id
    if legacy_ai is None or not isinstance(legacy_ai, int) or legacy_ai <= 0:
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": "Server configuration error"},
        )

    async def _create(conn):
        transfer_id = await generate_unique_transfer_id(conn)

        property_city = property_data.get("city") if is_non_empty_string(property_data.get("city")) else "Unknown"
        property_province = property_data.get("province") if is_non_empty_string(property_data.get("province")) else "Unknown"
        property_type = to_property_type(property_data.get("propertyType"))

        property_id = None
        if property_data:
            property_id_value = await generate_unique_property_id(conn)
            property_result = await query(
                """INSERT INTO properties (
                  property_id, street_address, suburb, city, postal_code, province,
                  country, property_type, erf_number, title_deed_number, extent_sqm, description,
                  legal_description, lot_number, year_built, square_footage, created_for_transfer_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                RETURNING id""",
                [
                    property_id_value,
                    property_address,
                    property_data.get("city") if is_non_empty_string(property_data.get("city")) else None,
                    property_city,
                    property_data.get("postalCode") if is_sa_postal_code(property_data.get("postalCode")) else None,
                    property_province,
                    property_data.get("country") if is_non_empty_string(property_data.get("country")) else "South Africa",
                    property_type,
                    property_data.get("erfNumber") if is_non_empty_string(property_data.get("erfNumber")) else None,
                    property_data.get("titleDeedNumber") if is_non_empty_string(property_data.get("titleDeedNumber")) else None,
                    to_number(property_data.get("extentSqm")),
                    property_data.get("description") if is_non_empty_string(property_data.get("description")) else None,
                    property_data.get("legalDescription") if is_non_empty_string(property_data.get("legalDescription")) else None,
                    property_data.get("lotNumber") if is_non_empty_string(property_data.get("lotNumber")) else None,
                    to_number(property_data.get("yearBuilt")),
                    to_number(property_data.get("squareFootage")),
                    transfer_id,
                ],
                connection=conn,
            )
            property_id = property_result.rows[0]["id"]

        status_value = "in_progress"
        current_step_value = current_step if isinstance(current_step, (int, float)) else 1
        total_steps_value = total_steps if isinstance(total_steps, (int, float)) else 5
        progress_value = progress if isinstance(progress, (int, float)) else 0

        transfer_result = await query(
            """INSERT INTO transfers (
              transfer_id, property_id, property_address, purchase_price, status,
              current_step, total_steps, progress, accountable_institution_id
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *""",
            [
                transfer_id,
                property_id,
                property_address,
                purchase_price,
                status_value,
                current_step_value,
                total_steps_value,
                progress_value,
                legacy_ai,
            ],
            connection=conn,
        )
        transfer_row = transfer_result.rows[0]
        transfer_uuid = transfer_row["id"]

        await query(
            """INSERT INTO transfer_financials (
              transfer_id, purchase_price, deposit_amount, loan_amount, interest_rate, loan_term_years,
              transfer_duty, conveyancing_fees, deeds_office_fees, vat, post_and_petties,
              clearance_certificate_fee, rates_clearance_amount, total_costs, net_proceeds
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)""",
            [
                transfer_uuid,
                purchase_price,
                n(financials.get("depositAmount")),
                n(financials.get("loanAmount")),
                to_number(financials.get("interestRate")),
                to_number(financials.get("loanTerm")),
                n(financials.get("transferDuty")),
                n(financials.get("conveyancingFees")),
                n(financials.get("deedsOfficeFees")),
                n(financials.get("vat")),
                n(financials.get("postAndPetties")),
                n(financials.get("clearanceCertificateFee")),
                n(financials.get("ratesClearanceAmount")),
                n(financials.get("totalCosts")),
                to_number(financials.get("netProceeds")),
            ],
            connection=conn,
        )

        created_parties = []
        for raw in parties:
            if not isinstance(raw, dict):
                continue
            party_name = raw.get("name") if is_non_empty_string(raw.get("name")) else None
            party_type = raw.get("type") if isinstance(raw.get("type"), str) and raw.get("type") in ["buyer", "seller"] else None
            if not party_name or not party_type:
                continue
            party_result = await query(
                """INSERT INTO parties (transfer_id, name, type, id_number, registration_number, email, phone, address, company_name, role_title, is_primary)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                 RETURNING *""",
                [
                    transfer_uuid,
                    party_name,
                    party_type,
                    raw.get("idNumber") if is_non_empty_string(raw.get("idNumber")) else None,
                    raw.get("registrationNumber") if is_non_empty_string(raw.get("registrationNumber")) else None,
                    raw.get("email") if is_non_empty_string(raw.get("email")) else None,
                    raw.get("phone") if is_non_empty_string(raw.get("phone")) else None,
                    raw.get("address") if is_non_empty_string(raw.get("address")) else None,
                    raw.get("company") if is_non_empty_string(raw.get("company")) else None,
                    raw.get("role") if is_non_empty_string(raw.get("role")) else None,
                    raw.get("isPrimary") is True,
                ],
                connection=conn,
            )
            created_parties.append(map_party_row(party_result.rows[0]))

        matter_id = await get_or_create_matter_for_transfer(conn, transfer_uuid, transfer_id, legacy_ai)
        await create_default_milestones(conn, matter_id)
        await seed_transfer_documents(conn, transfer_uuid)

        financials_result = await query("SELECT * FROM transfer_financials WHERE transfer_id = $1", [transfer_uuid], connection=conn)
        documents_result = await query(
            """SELECT td.*, dc.catalogue_code, dc.module, dc.matter_type
               FROM transfer_documents td
               LEFT JOIN document_catalogue dc ON dc.id = td.catalogue_document_id
               WHERE td.transfer_id = $1
               ORDER BY td.created_at""",
            [transfer_uuid],
            connection=conn,
        )

        return {
            **map_transfer_row(transfer_row),
            "property": map_property_row({
                **transfer_row,
                "street_address": property_address,
                "city": property_city,
                "province": property_province,
                "property_type": property_type,
            }),
            "parties": created_parties,
            "financials": map_financial_row(financials_result.rows[0] if financials_result.rows else None),
            "documents": [map_document_row(row) for row in documents_result.rows],
        }

    new_transfer = await with_transaction(_create)
    return JSONResponse(
        status_code=201,
        content=jsonable_encoder({
            "success": True,
            "data": new_transfer,
            "message": "Transfer created successfully",
        }),
    )


@router.put("/{id}")
async def update_transfer(id: str, body: dict):
    transfer_result = await query(
        f"SELECT id, transfer_id, accountable_institution_id FROM transfers WHERE transfer_id = $1{' OR id = $1::uuid' if is_uuid(id) else ''}",
        [id],
    )
    if not transfer_result.rows:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "Transfer not found"},
        )
    transfer_uuid = transfer_result.rows[0]["id"]
    transfer_reference = transfer_result.rows[0]["transfer_id"]
    transfer_ai = transfer_result.rows[0]["accountable_institution_id"]

    property_data = body.get("property") or {}
    parties = _resolve_parties(body.get("parties"))
    financials = body.get("financials") or {}
    documents = _resolve_parties(body.get("documents"))
    status = body.get("status")
    current_step = body.get("currentStep")
    total_steps = body.get("totalSteps")
    progress = body.get("progress")

    async def _update(conn):
        transfer_updates = []
        transfer_params = []
        param_idx = 1

        if property_data and is_non_empty_string(property_data.get("address")):
            transfer_updates.append(f"property_address = ${param_idx}")
            transfer_params.append(property_data["address"])
            param_idx += 1

        purchase_price = to_number(financials.get("purchasePrice"))
        if purchase_price is not None:
            transfer_updates.append(f"purchase_price = ${param_idx}")
            transfer_params.append(purchase_price)
            param_idx += 1

        if is_valid_transfer_status(status):
            transfer_updates.append(f"status = ${param_idx}")
            transfer_params.append(status)
            param_idx += 1

        if isinstance(current_step, (int, float)):
            transfer_updates.append(f"current_step = ${param_idx}")
            transfer_params.append(current_step)
            param_idx += 1

        if isinstance(total_steps, (int, float)):
            transfer_updates.append(f"total_steps = ${param_idx}")
            transfer_params.append(total_steps)
            param_idx += 1

        if isinstance(progress, (int, float)):
            transfer_updates.append(f"progress = ${param_idx}")
            transfer_params.append(progress)
            param_idx += 1

        if transfer_updates:
            transfer_updates.append("updated_at = CURRENT_TIMESTAMP")
            transfer_params.append(transfer_uuid)
            await query(
                f"UPDATE transfers SET {', '.join(transfer_updates)} WHERE id = ${param_idx}",
                transfer_params,
                connection=conn,
            )

        if property_data and transfer_updates:
            property_result = await query("SELECT property_id FROM transfers WHERE id = $1", [transfer_uuid], connection=conn)
            property_id = property_result.rows[0]["property_id"] if property_result.rows else None

            if not property_id and is_non_empty_string(property_data.get("address")):
                property_id_value = await generate_unique_property_id(conn)
                insert_result = await query(
                    """INSERT INTO properties (
                      property_id, street_address, suburb, city, postal_code, province,
                      country, property_type, erf_number, title_deed_number, extent_sqm, description,
                      legal_description, lot_number, year_built, square_footage
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                    RETURNING id""",
                    [
                        property_id_value,
                        property_data["address"],
                        property_data.get("city") if is_non_empty_string(property_data.get("city")) else None,
                        property_data.get("city") if is_non_empty_string(property_data.get("city")) else None,
                        property_data.get("postalCode") if is_sa_postal_code(property_data.get("postalCode")) else None,
                        property_data.get("province") if is_non_empty_string(property_data.get("province")) else None,
                        property_data.get("country") if is_non_empty_string(property_data.get("country")) else "South Africa",
                        to_property_type(property_data.get("propertyType")),
                        property_data.get("erfNumber") if is_non_empty_string(property_data.get("erfNumber")) else None,
                        property_data.get("titleDeedNumber") if is_non_empty_string(property_data.get("titleDeedNumber")) else None,
                        to_number(property_data.get("extentSqm")),
                        property_data.get("description") if is_non_empty_string(property_data.get("description")) else None,
                        property_data.get("legalDescription") if is_non_empty_string(property_data.get("legalDescription")) else None,
                        property_data.get("lotNumber") if is_non_empty_string(property_data.get("lotNumber")) else None,
                        to_number(property_data.get("yearBuilt")),
                        to_number(property_data.get("squareFootage")),
                    ],
                    connection=conn,
                )
                property_id = insert_result.rows[0]["id"]
                await query("UPDATE transfers SET property_id = $1 WHERE id = $2", [property_id, transfer_uuid], connection=conn)

            if property_id:
                property_updates = []
                property_params = []
                p_idx = 1

                def add(key, value):
                    nonlocal p_idx
                    property_updates.append(f"{key} = ${p_idx}")
                    property_params.append(value)
                    p_idx += 1

                if is_non_empty_string(property_data.get("address")):
                    add("street_address", property_data["address"])
                if is_non_empty_string(property_data.get("city")):
                    add("city", property_data["city"])
                if is_non_empty_string(property_data.get("province")):
                    add("province", property_data["province"])
                if is_sa_postal_code(property_data.get("postalCode")):
                    add("postal_code", property_data["postalCode"])
                if is_non_empty_string(property_data.get("country")):
                    add("country", property_data["country"])
                if is_non_empty_string(property_data.get("propertyType")):
                    add("property_type", to_property_type(property_data["propertyType"]))
                if is_non_empty_string(property_data.get("erfNumber")):
                    add("erf_number", property_data["erfNumber"])
                if is_non_empty_string(property_data.get("titleDeedNumber")):
                    add("title_deed_number", property_data["titleDeedNumber"])
                if to_number(property_data.get("extentSqm")) is not None:
                    add("extent_sqm", to_number(property_data.get("extentSqm")))
                if is_non_empty_string(property_data.get("description")):
                    add("description", property_data["description"])
                if is_non_empty_string(property_data.get("legalDescription")):
                    add("legal_description", property_data["legalDescription"])
                if is_non_empty_string(property_data.get("lotNumber")):
                    add("lot_number", property_data["lotNumber"])
                if to_number(property_data.get("yearBuilt")) is not None:
                    add("year_built", to_number(property_data.get("yearBuilt")))
                if to_number(property_data.get("squareFootage")) is not None:
                    add("square_footage", to_number(property_data.get("squareFootage")))

                if property_updates:
                    property_updates.append("updated_at = CURRENT_TIMESTAMP")
                    property_params.append(property_id)
                    await query(
                        f"UPDATE properties SET {', '.join(property_updates)} WHERE id = ${p_idx}",
                        property_params,
                        connection=conn,
                    )

        if financials and len(financials) > 0:
            existing = await query("SELECT 1 FROM transfer_financials WHERE transfer_id = $1", [transfer_uuid], connection=conn)
            fin_exists = bool(existing.rows)

            fields = {
                "purchase_price": n(financials.get("purchasePrice")),
                "deposit_amount": n(financials.get("depositAmount")),
                "loan_amount": n(financials.get("loanAmount")),
                "interest_rate": to_number(financials.get("interestRate")),
                "loan_term_years": to_number(financials.get("loanTerm")),
                "transfer_duty": n(financials.get("transferDuty")),
                "conveyancing_fees": n(financials.get("conveyancingFees")),
                "deeds_office_fees": n(financials.get("deedsOfficeFees")),
                "vat": n(financials.get("vat")),
                "post_and_petties": n(financials.get("postAndPetties")),
                "clearance_certificate_fee": n(financials.get("clearanceCertificateFee")),
                "rates_clearance_amount": n(financials.get("ratesClearanceAmount")),
                "total_costs": n(financials.get("totalCosts")),
                "net_proceeds": to_number(financials.get("netProceeds")),
            }

            updates = [{"col": k, "val": v} for k, v in fields.items() if v is not None]

            if fin_exists:
                if updates:
                    set_clause = ", ".join([f"{u['col']} = ${i + 1}" for i, u in enumerate(updates)])
                    values = [u["val"] for u in updates] + [transfer_uuid]
                    await query(
                        f"UPDATE transfer_financials SET {set_clause}, updated_at = CURRENT_TIMESTAMP WHERE transfer_id = ${len(updates) + 1}",
                        values,
                        connection=conn,
                    )
            else:
                await query(
                    """INSERT INTO transfer_financials (
                      transfer_id, purchase_price, deposit_amount, loan_amount, interest_rate, loan_term_years,
                      transfer_duty, conveyancing_fees, deeds_office_fees, vat, post_and_petties,
                      clearance_certificate_fee, rates_clearance_amount, total_costs, net_proceeds
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)""",
                    [
                        transfer_uuid,
                        fields["purchase_price"],
                        fields["deposit_amount"],
                        fields["loan_amount"],
                        fields["interest_rate"],
                        fields["loan_term_years"],
                        fields["transfer_duty"],
                        fields["conveyancing_fees"],
                        fields["deeds_office_fees"],
                        fields["vat"],
                        fields["post_and_petties"],
                        fields["clearance_certificate_fee"],
                        fields["rates_clearance_amount"],
                        fields["total_costs"],
                        fields["net_proceeds"],
                    ],
                    connection=conn,
                )

        if parties:
            retained_ids = [p["id"] for p in parties if isinstance(p, dict) and is_uuid(p.get("id"))]
            if retained_ids:
                await query(
                    "DELETE FROM parties WHERE transfer_id = $1 AND NOT (id = ANY($2::uuid[]))",
                    [transfer_uuid, retained_ids],
                    connection=conn,
                )
            else:
                await query("DELETE FROM parties WHERE transfer_id = $1", [transfer_uuid], connection=conn)

            for raw in parties:
                if not isinstance(raw, dict):
                    continue
                party_id = raw.get("id") if is_uuid(raw.get("id")) else None
                party_name = raw.get("name") if is_non_empty_string(raw.get("name")) else None
                party_type = raw.get("type") if isinstance(raw.get("type"), str) and raw.get("type") in ["buyer", "seller"] else None

                if not party_name or not party_type:
                    continue

                if party_id:
                    existing = await query(
                        "SELECT id FROM parties WHERE id = $1 AND transfer_id = $2",
                        [party_id, transfer_uuid],
                        connection=conn,
                    )
                    if existing.rows:
                        await query(
                            """UPDATE parties SET
                              name = $1, type = $2, id_number = $3, registration_number = $4, email = $5, phone = $6, address = $7,
                              company_name = $8, role_title = $9, is_primary = $10, updated_at = CURRENT_TIMESTAMP
                            WHERE id = $11 AND transfer_id = $12""",
                            [
                                party_name,
                                party_type,
                                raw.get("idNumber") if is_non_empty_string(raw.get("idNumber")) else None,
                                raw.get("registrationNumber") if is_non_empty_string(raw.get("registrationNumber")) else None,
                                raw.get("email") if is_non_empty_string(raw.get("email")) else None,
                                raw.get("phone") if is_non_empty_string(raw.get("phone")) else None,
                                raw.get("address") if is_non_empty_string(raw.get("address")) else None,
                                raw.get("company") if is_non_empty_string(raw.get("company")) else None,
                                raw.get("role") if is_non_empty_string(raw.get("role")) else None,
                                raw.get("isPrimary") is True,
                                party_id,
                                transfer_uuid,
                            ],
                            connection=conn,
                        )
                else:
                    await query(
                        """INSERT INTO parties (transfer_id, name, type, id_number, registration_number, email, phone, address, company_name, role_title, is_primary)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)""",
                        [
                            transfer_uuid,
                            party_name,
                            party_type,
                            raw.get("idNumber") if is_non_empty_string(raw.get("idNumber")) else None,
                            raw.get("registrationNumber") if is_non_empty_string(raw.get("registrationNumber")) else None,
                            raw.get("email") if is_non_empty_string(raw.get("email")) else None,
                            raw.get("phone") if is_non_empty_string(raw.get("phone")) else None,
                            raw.get("address") if is_non_empty_string(raw.get("address")) else None,
                            raw.get("company") if is_non_empty_string(raw.get("company")) else None,
                            raw.get("role") if is_non_empty_string(raw.get("role")) else None,
                            raw.get("isPrimary") is True,
                        ],
                        connection=conn,
                    )

        if documents:
            for raw in documents:
                if not isinstance(raw, dict):
                    continue
                doc_id = raw.get("id") if is_uuid(raw.get("id")) else None
                catalogue_document_id = raw.get("catalogueDocumentId") if is_uuid(raw.get("catalogueDocumentId")) else None
                if not doc_id and not catalogue_document_id:
                    continue

                notes_value = raw.get("notes") if is_non_empty_string(raw.get("notes")) else (
                    raw.get("description") if is_non_empty_string(raw.get("description")) else None
                )

                if doc_id:
                    await query(
                        """UPDATE transfer_documents
                           SET status = $1, notes = $2, updated_at = CURRENT_TIMESTAMP
                           WHERE id = $3 AND transfer_id = $4""",
                        [
                            raw.get("status") if isinstance(raw.get("status"), str) else "pending",
                            notes_value,
                            doc_id,
                            transfer_uuid,
                        ],
                        connection=conn,
                    )
                elif catalogue_document_id:
                    await query(
                        """UPDATE transfer_documents
                           SET status = $1, notes = $2, updated_at = CURRENT_TIMESTAMP
                           WHERE transfer_id = $3 AND catalogue_document_id = $4""",
                        [
                            raw.get("status") if isinstance(raw.get("status"), str) else "pending",
                            notes_value,
                            transfer_uuid,
                            catalogue_document_id,
                        ],
                        connection=conn,
                    )

        await get_or_create_matter_for_transfer(conn, transfer_uuid, transfer_reference, transfer_ai)

        final_transfer = await query(
            """SELECT t.*, p.id as property_row_id, p.property_id, p.erf_number, p.street_address, p.suburb, p.city,
                p.postal_code, p.province, p.country, p.property_type, p.title_deed_number, p.extent_sqm,
                p.description as property_description, p.legal_description, p.lot_number, p.year_built, p.square_footage,
                p.status as property_status, p.created_at as property_created_at, p.updated_at as property_updated_at
         FROM transfers t
         LEFT JOIN properties p ON t.property_id = p.id
         WHERE t.id = $1""",
            [transfer_uuid],
            connection=conn,
        )
        final_parties = await query("SELECT * FROM parties WHERE transfer_id = $1 ORDER BY type, name", [transfer_uuid], connection=conn)
        final_docs = await query(
            """SELECT td.*, dc.catalogue_code, dc.module, dc.matter_type
               FROM transfer_documents td
               LEFT JOIN document_catalogue dc ON dc.id = td.catalogue_document_id
               WHERE td.transfer_id = $1
               ORDER BY td.created_at""",
            [transfer_uuid],
            connection=conn,
        )
        final_financials = await query("SELECT * FROM transfer_financials WHERE transfer_id = $1", [transfer_uuid], connection=conn)

        final_row = final_transfer.rows[0]
        return {
            **map_transfer_row(final_row),
            "property": map_property_row({
                "id": final_row["property_row_id"],
                "property_id": final_row["property_id"],
                "erf_number": final_row["erf_number"],
                "street_address": final_row["street_address"] or final_row["property_address"],
                "suburb": final_row["suburb"],
                "city": final_row["city"],
                "postal_code": final_row["postal_code"],
                "province": final_row["province"],
                "country": final_row["country"],
                "property_type": final_row["property_type"],
                "title_deed_number": final_row["title_deed_number"],
                "extent_sqm": final_row["extent_sqm"],
                "description": final_row["property_description"],
                "legal_description": final_row["legal_description"],
                "lot_number": final_row["lot_number"],
                "year_built": final_row["year_built"],
                "square_footage": final_row["square_footage"],
                "status": final_row["property_status"],
                "created_at": final_row["property_created_at"],
                "updated_at": final_row["property_updated_at"],
            }),
            "parties": [map_party_row(row) for row in final_parties.rows],
            "financials": map_financial_row(final_financials.rows[0] if final_financials.rows else None),
            "documents": [map_document_row(row) for row in final_docs.rows],
        }

    updated = await with_transaction(_update)
    return {"success": True, "data": updated, "message": "Transfer updated successfully"}


@router.delete("/{id}")
async def delete_transfer(id: str):
    async def _delete(conn):
        transfer_result = await query(
            f"""SELECT id, transfer_id, matter_id, property_id
                  FROM transfers
                 WHERE transfer_id = $1{' OR id = $1::uuid' if is_uuid(id) else ''}
                   FOR UPDATE""",
            [id],
            connection=conn,
        )
        if not transfer_result.rows:
            return JSONResponse(
                status_code=404,
                content={"success": False, "error": "Transfer not found"},
            )

        transfer_row = transfer_result.rows[0]
        transfer_uuid = str(transfer_row["id"])
        transfer_ref = transfer_row["transfer_id"]
        matter_id = transfer_row["matter_id"]
        property_id = transfer_row["property_id"]

        await query(
            "DELETE FROM transfers WHERE id = $1",
            [transfer_uuid],
            connection=conn,
        )

        # Identify the matter by the actual relationship: matters.source_record_id = transfers.id.
        # Do not rely solely on transfers.matter_id, which the legacy create path does not populate.
        matter_count_result = await query(
            "SELECT COUNT(*) as count FROM matters WHERE source_record_id = $1 AND matter_type = 'transfer'",
            [transfer_uuid],
            connection=conn,
        )
        matter_count = int(matter_count_result.rows[0]["count"])

        # Only proceed with a single, unambiguous matter. Duplicate/corrupt source_record_ids
        # fail safely by retaining the matter rows.
        if matter_count == 1:
            matter_result = await query(
                "SELECT id, matter_type, source_record_id FROM matters WHERE source_record_id = $1 AND matter_type = 'transfer' FOR UPDATE",
                [transfer_uuid],
                connection=conn,
            )
            if matter_result.rows:
                matter_row = matter_result.rows[0]
                can_delete_matter = (
                    matter_row["matter_type"] == "transfer"
                    and matter_row["source_record_id"] == transfer_uuid
                )

                if can_delete_matter:
                    linked_matter_id = matter_row["id"]

                    other_transfers = await query(
                        "SELECT COUNT(*) as count FROM transfers WHERE matter_id = $1 AND id != $2",
                        [linked_matter_id, transfer_uuid],
                        connection=conn,
                    )
                    has_other_transfers = int(other_transfers.rows[0]["count"]) > 0

                    blocking_queries = [
                        "SELECT COUNT(*) as count FROM bonds WHERE matter_id = $1",
                        "SELECT COUNT(*) as count FROM clearance_records WHERE matter_id = $1",
                        "SELECT COUNT(*) as count FROM compliance_certificates WHERE matter_id = $1",
                        "SELECT COUNT(*) as count FROM fica_verifications WHERE matter_id = $1",
                        "SELECT COUNT(*) as count FROM matter_accounts WHERE matter_id = $1",
                        "SELECT COUNT(*) as count FROM matter_parties WHERE matter_id = $1",
                        "SELECT COUNT(*) as count FROM parties WHERE matter_id = $1",
                    ]

                    has_blocking_children = False
                    for text in blocking_queries:
                        count_result = await query(text, [linked_matter_id], connection=conn)
                        if int(count_result.rows[0]["count"]) > 0:
                            has_blocking_children = True
                            break

                    if not has_other_transfers and not has_blocking_children:
                        await query(
                            "DELETE FROM matters WHERE id = $1",
                            [linked_matter_id],
                            connection=conn,
                        )

        if property_id:
            property_result = await query(
                "SELECT created_for_transfer_id FROM properties WHERE id = $1 FOR UPDATE",
                [property_id],
                connection=conn,
            )
            if property_result.rows:
                property_row = property_result.rows[0]
                is_auto_created = property_row["created_for_transfer_id"] == transfer_ref

                if is_auto_created:
                    ref_queries = [
                        "SELECT COUNT(*) as count FROM transfers WHERE property_id = $1 AND id != $2",
                        "SELECT COUNT(*) as count FROM matters WHERE property_id = $1",
                        "SELECT COUNT(*) as count FROM municipal_accounts WHERE property_id = $1",
                        "SELECT COUNT(*) as count FROM compliance_certificates WHERE property_id = $1",
                    ]

                    has_references = False
                    for text in ref_queries:
                        # The transfers query needs the deleted transfer id excluded;
                        # the other reference checks only need the property id.
                        ref_params = [property_id, transfer_uuid] if "FROM transfers" in text else [property_id]
                        count_result = await query(text, ref_params, connection=conn)
                        if int(count_result.rows[0]["count"]) > 0:
                            has_references = True
                            break

                    if not has_references:
                        await query(
                            "DELETE FROM properties WHERE id = $1",
                            [property_id],
                            connection=conn,
                        )

        return {"success": True, "data": True, "message": "Transfer deleted successfully"}

    return await with_transaction(_delete)


@router.get("/{id}/parties")
async def get_parties(id: str):
    transfer_result = await query(
        f"SELECT id FROM transfers WHERE transfer_id = $1{' OR id = $1::uuid' if is_uuid(id) else ''}",
        [id],
    )
    if not transfer_result.rows:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "Transfer not found"},
        )
    parties_result = await query("SELECT * FROM parties WHERE transfer_id = $1 ORDER BY type, name", [transfer_result.rows[0]["id"]])
    return {"success": True, "data": [map_party_row(row) for row in parties_result.rows]}


@router.get("/{id}/documents")
async def get_documents(id: str):
    transfer_result = await query(
        f"SELECT id FROM transfers WHERE transfer_id = $1{' OR id = $1::uuid' if is_uuid(id) else ''}",
        [id],
    )
    if not transfer_result.rows:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "Transfer not found"},
        )
    documents_result = await query(
        """SELECT td.*, dc.catalogue_code, dc.module, dc.matter_type
           FROM transfer_documents td
           LEFT JOIN document_catalogue dc ON dc.id = td.catalogue_document_id
           WHERE td.transfer_id = $1
           ORDER BY td.created_at""",
        [transfer_result.rows[0]["id"]],
    )
    return {"success": True, "data": [map_document_row(row) for row in documents_result.rows]}


@router.post("/{id}/documents/{document_id}/upload")
async def upload_transfer_document(id: str, document_id: str, body: dict):
    file_name = body.get("fileName")
    file_type = body.get("fileType")
    file_data = body.get("fileData")

    if not is_non_empty_string(file_name) or not is_non_empty_string(file_data):
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "fileName and fileData are required"},
        )

    transfer_result = await query(
        f"SELECT id FROM transfers WHERE transfer_id = $1{' OR id = $1::uuid' if is_uuid(id) else ''}",
        [id],
    )
    if not transfer_result.rows:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "Transfer not found"},
        )
    transfer_uuid = transfer_result.rows[0]["id"]

    async def _save(conn):
        return await save_transfer_document_upload(
            conn,
            transfer_uuid,
            document_id,
            file_name,
            file_type if isinstance(file_type, str) else "application/octet-stream",
            file_data,
        )

    updated = await with_transaction(_save)
    if not updated:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "Transfer document not found"},
        )

    return {"success": True, "data": map_document_row(updated), "message": "Document uploaded successfully"}


@router.post("/{id}/documents")
async def add_transfer_document(id: str, body: dict):
    catalogue_document_id = body.get("catalogueDocumentId")
    name = body.get("name")

    transfer_result = await query(
        f"SELECT id FROM transfers WHERE transfer_id = $1{' OR id = $1::uuid' if is_uuid(id) else ''}",
        [id],
    )
    if not transfer_result.rows:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "Transfer not found"},
        )
    transfer_uuid = transfer_result.rows[0]["id"]

    async def _create(conn):
        if is_uuid(catalogue_document_id):
            catalogue_result = await query("SELECT name FROM document_catalogue WHERE id = $1", [catalogue_document_id], connection=conn)
            if not catalogue_result.rows:
                return None
            catalogue_name = catalogue_result.rows[0]["name"]
            insert_result = await query(
                """INSERT INTO transfer_documents (transfer_id, catalogue_document_id, name, status)
                 VALUES ($1, $2, $3, 'pending')
                 ON CONFLICT (transfer_id, catalogue_document_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
                 RETURNING *""",
                [transfer_uuid, catalogue_document_id, catalogue_name],
                connection=conn,
            )
            return insert_result.rows[0]

        if not is_non_empty_string(name):
            return "missing"

        insert_result = await query(
            """INSERT INTO transfer_documents (transfer_id, name, status)
             VALUES ($1, $2, 'pending')
             RETURNING *""",
            [transfer_uuid, name],
            connection=conn,
        )
        return insert_result.rows[0]

    new_document = await with_transaction(_create)
    if new_document is None:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "Catalogue document not found"},
        )
    if new_document == "missing":
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "catalogueDocumentId or name is required"},
        )

    return JSONResponse(
        status_code=201,
        content={"success": True, "data": map_document_row(new_document), "message": "Document added to transfer"},
    )


@router.patch("/{id}/documents/{document_id}")
async def patch_transfer_document(id: str, document_id: str, body: dict):
    status = body.get("status")
    notes = body.get("notes")

    transfer_result = await query(
        f"SELECT id FROM transfers WHERE transfer_id = $1{' OR id = $1::uuid' if is_uuid(id) else ''}",
        [id],
    )
    if not transfer_result.rows:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "Transfer not found"},
        )
    transfer_uuid = transfer_result.rows[0]["id"]

    updates = []
    params = []
    param_idx = 1

    valid_statuses = ["pending", "uploaded", "verified", "rejected", "not_required"]
    if isinstance(status, str) and status in valid_statuses:
        updates.append(f"status = ${param_idx}")
        params.append(status)
        param_idx += 1

    if isinstance(notes, str):
        updates.append(f"notes = ${param_idx}")
        params.append(notes)
        param_idx += 1

    if not updates:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": "status or notes is required"},
        )

    updates.append("updated_at = CURRENT_TIMESTAMP")
    params.extend([document_id, transfer_uuid])
    result = await query(
        f"UPDATE transfer_documents SET {', '.join(updates)} WHERE id = ${param_idx} AND transfer_id = ${param_idx + 1} RETURNING *",
        params,
    )

    if not result.rows:
        return JSONResponse(
            status_code=404,
            content={"success": False, "error": "Transfer document not found"},
        )

    return {"success": True, "data": map_document_row(result.rows[0]), "message": "Document updated successfully"}
