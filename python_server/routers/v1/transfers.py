import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

from auth.current_user import CurrentUser
from auth.dependencies import require_jwt
from auth.policy import is_cross_tenant
from db import query

router = APIRouter()

DEFAULT_SORT_COLUMNS = ["created_at", "updated_at", "property_address", "status", "purchase_price"]


SELECT_TRANSFER_COLUMNS = """
    SELECT t.id, t.transfer_id, t.property_address, t.purchase_price, t.status,
           t.current_step, t.total_steps, t.progress, t.created_at, t.updated_at
"""


def _map_transfer(row: dict) -> dict:
    return {
        "id": row["id"],
        "transferId": row["transfer_id"],
        "propertyAddress": row["property_address"],
        "purchasePrice": float(row["purchase_price"]) if row["purchase_price"] is not None else None,
        "status": row["status"],
        "currentStep": row["current_step"],
        "totalSteps": row["total_steps"],
        "progress": int(row["progress"]) if row["progress"] is not None else None,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "parties": [],
    }


def _map_transfer_party(row: dict) -> dict:
    return {
        "id": row["id"],
        "transferId": row["transfer_id"],
        "goldenRecordId": row["golden_record_id"],
        "entityType": row["entity_type"],
        "role": row["role"],
        "accountableInstitutionId": row["accountable_institution_id"],
        "cachedName": row["cached_name"],
        "cachedIdNumber": row["cached_id_number"],
        "cachedEmail": row["cached_email"],
        "syncedAt": row["synced_at"],
    }


# Client party projection is intentionally conservative. The handover defines that
# a client may only see matters where their golden_record_id is a party, but it
# does not document which fields or other parties a client may view. Until that
# contract is explicit, the client receives only their own row and a minimal
# cache subset.
def _map_client_transfer_party(row: dict) -> dict:
    return {
        "id": row["id"],
        "transferId": row["transfer_id"],
        "goldenRecordId": row["golden_record_id"],
        "entityType": row["entity_type"],
        "role": row["role"],
        "cachedName": row["cached_name"],
        "syncedAt": row["synced_at"],
    }


def _to_number(value):
    return float(value) if value is not None else None


def _map_transfer_document(row: dict) -> dict:
    return {
        "id": row["id"],
        "transferId": row["transfer_id"],
        "catalogueDocumentId": row["catalogue_document_id"],
        "name": row["name"],
        "status": row["status"],
        "notes": row["notes"],
        "fileSize": row["file_size"],
        "fileType": row["file_type"],
        "originalFileName": row["original_file_name"],
        "uploadedAt": row["uploaded_at"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _map_transfer_financials(row: dict) -> dict:
    return {
        "transferId": row["transfer_id"],
        "purchasePrice": _to_number(row["purchase_price"]),
        "depositAmount": _to_number(row["deposit_amount"]),
        "loanAmount": _to_number(row["loan_amount"]),
        "interestRate": _to_number(row["interest_rate"]),
        "loanTerm": _to_number(row["loan_term_years"]),
        "transferDuty": _to_number(row["transfer_duty"]),
        "conveyancingFees": _to_number(row["conveyancing_fees"]),
        "deedsOfficeFees": _to_number(row["deeds_office_fees"]),
        "vat": _to_number(row["vat"]),
        "postAndPetties": _to_number(row["post_and_petties"]),
        "clearanceCertificateFee": _to_number(row["clearance_certificate_fee"]),
        "ratesClearanceAmount": _to_number(row["rates_clearance_amount"]),
        "totalCosts": _to_number(row["total_costs"]),
        "netProceeds": _to_number(row["net_proceeds"]),
        "effectiveRate": _to_number(row["effective_rate"]),
        "loanToValueRatio": _to_number(row["loan_to_value_ratio"]),
        "currencyCode": row["currency_code"],
        "calculationVersion": row["calculation_version"],
        "calculationDetails": row["calculation_details"],
        "calculatedAt": row["calculated_at"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _is_valid_uuid(value: str) -> bool:
    return bool(re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", value, re.IGNORECASE))


async def _authorize_transfer(user: CurrentUser, id: str):
    """Return the authorised transfer row, or None if not accessible."""

    if not _is_valid_uuid(id):
        return None

    if user.is_client:
        if not user.golden_record_id:
            return None

        client_sql = f"""
            {SELECT_TRANSFER_COLUMNS}
            FROM transfers t
            WHERE t.id = $1
              AND EXISTS (
                SELECT 1 FROM transfer_parties tp
                WHERE tp.transfer_id = t.id AND tp.golden_record_id = $2::uuid
              )
        """
        client_result = await query(client_sql, [id, user.golden_record_id])
        return client_result.rows[0] if client_result.rows else None

    cross_tenant = is_cross_tenant(user)

    if cross_tenant:
        detail_sql = f"""
            {SELECT_TRANSFER_COLUMNS}
            FROM transfers t
            WHERE t.id = $1
        """
        detail_params = [id]
    else:
        detail_sql = f"""
            {SELECT_TRANSFER_COLUMNS}
            FROM transfers t
            WHERE t.id = $1 AND t.accountable_institution_id = $2
        """
        detail_params = [id, user.accountable_institution_id]

    detail_result = await query(detail_sql, detail_params)
    return detail_result.rows[0] if detail_result.rows else None


def _parse_pagination_params(request: Request):
    try:
        page = max(1, int(request.query_params.get("page", "1")))
    except (TypeError, ValueError):
        page = 1
    try:
        limit = min(100, max(1, int(request.query_params.get("limit", "10"))))
    except (TypeError, ValueError):
        limit = 10
    sort_by = request.query_params.get("sortBy", "created_at")
    if sort_by not in DEFAULT_SORT_COLUMNS:
        sort_by = "created_at"
    sort_order = "asc" if request.query_params.get("sortOrder", "").lower() == "asc" else "desc"
    return {"page": page, "limit": limit, "sort_by": sort_by, "sort_order": sort_order}


@router.get("/")
async def list_transfers(
    request: Request,
    user: CurrentUser = Depends(require_jwt),
):
    """List transfers scoped to the authenticated user's tenant."""

    # Clients (role 4) must prove Golden Record party membership before seeing any transfer.
    # transfer_parties is currently empty, so the safe default is an empty list.
    if user.is_client:
        return {
            "message": "OK",
            "data": {
                "transfers": [],
                "pagination": {"page": 1, "limit": 10, "total": 0, "totalPages": 0},
            },
        }

    # Staff must hold the documented transfers:read ability (handover §4.5).
    if not user.has_ability("transfers:read"):
        return JSONResponse(status_code=403, content={"success": False, "error": "Forbidden"})

    filters = _parse_pagination_params(request)
    offset = (filters["page"] - 1) * filters["limit"]
    cross_tenant = is_cross_tenant(user)

    if cross_tenant:
        count_sql = "SELECT COUNT(*) AS total FROM transfers t"
        count_params = []
        data_sql = f"""
            SELECT t.id, t.transfer_id, t.property_address, t.purchase_price, t.status,
                   t.current_step, t.total_steps, t.progress, t.created_at, t.updated_at
            FROM transfers t
            ORDER BY t.{filters['sort_by']} {filters['sort_order'].upper()}
            LIMIT $1 OFFSET $2
        """
        data_params = [filters["limit"], offset]
    else:
        count_sql = "SELECT COUNT(*) AS total FROM transfers t WHERE t.accountable_institution_id = $1"
        count_params = [user.accountable_institution_id]
        data_sql = f"""
            SELECT t.id, t.transfer_id, t.property_address, t.purchase_price, t.status,
                   t.current_step, t.total_steps, t.progress, t.created_at, t.updated_at
            FROM transfers t
            WHERE t.accountable_institution_id = $1
            ORDER BY t.{filters['sort_by']} {filters['sort_order'].upper()}
            LIMIT $2 OFFSET $3
        """
        data_params = [user.accountable_institution_id, filters["limit"], offset]

    count_result = await query(count_sql, count_params)
    total = int(count_result.rows[0]["total"])

    data_result = await query(data_sql, data_params)
    transfers = [_map_transfer(row) for row in data_result.rows]

    return {
        "message": "OK",
        "data": {
            "transfers": transfers,
            "pagination": {
                "page": filters["page"],
                "limit": filters["limit"],
                "total": total,
                "totalPages": (total + filters["limit"] - 1) // filters["limit"] or 1,
            },
        },
    }


@router.get("/{id}/parties")
async def get_transfer_parties(
    id: str,
    user: CurrentUser = Depends(require_jwt),
):
    """List parties for a transfer, scoped to the authorised tenant."""

    # Staff must hold the documented transfers:read ability (handover §4.5).
    # Role 4 (Client) is not in the canonical transfers:read assignment; client
    # access is governed by the GR party rule implemented in _authorize_transfer.
    if not user.is_client and not user.has_ability("transfers:read"):
        raise HTTPException(status_code=403, detail="Forbidden")

    transfer = await _authorize_transfer(user, id)
    if not transfer:
        raise HTTPException(status_code=404, detail="Not found")

    # Clients are restricted to their own transfer_parties row.
    # The client projection is intentionally conservative: the handover does not
    # define which party fields or other parties a client may view, so we return
    # only the matching row and a minimal cache subset until that platform
    # contract exists.
    if user.is_client:
        client_parties_sql = """
            SELECT id, transfer_id, golden_record_id, entity_type, role, cached_name, synced_at
            FROM transfer_parties
            WHERE transfer_id = $1
              AND golden_record_id = $2::uuid
              AND accountable_institution_id = (
                SELECT accountable_institution_id FROM transfers WHERE id = $1
              )
            ORDER BY cached_name
        """
        client_parties_result = await query(client_parties_sql, [id, user.golden_record_id])
        parties = [_map_client_transfer_party(row) for row in client_parties_result.rows]
        return {"message": "OK", "data": {"parties": parties}}

    cross_tenant = is_cross_tenant(user)

    # Tenant-defence in depth: ordinary staff only see parties for their AI.
    # Cross-tenant staff see all parties for the already-authorised transfer.
    if cross_tenant:
        parties_sql = """
            SELECT id, transfer_id, golden_record_id, entity_type, role,
                   accountable_institution_id, cached_name, cached_id_number, cached_email, synced_at
            FROM transfer_parties
            WHERE transfer_id = $1
            ORDER BY cached_name
        """
        parties_params = [id]
    else:
        parties_sql = """
            SELECT id, transfer_id, golden_record_id, entity_type, role,
                   accountable_institution_id, cached_name, cached_id_number, cached_email, synced_at
            FROM transfer_parties
            WHERE transfer_id = $1 AND accountable_institution_id = $2
            ORDER BY cached_name
        """
        parties_params = [id, user.accountable_institution_id]

    parties_result = await query(parties_sql, parties_params)
    parties = [_map_transfer_party(row) for row in parties_result.rows]

    return {"message": "OK", "data": {"parties": parties}}


@router.get("/{id}/documents")
async def get_transfer_documents(
    id: str,
    user: CurrentUser = Depends(require_jwt),
):
    """List document metadata for a transfer, scoped to the authorised tenant."""

    # Client document visibility is not documented. Fail closed.
    if user.is_client:
        raise HTTPException(status_code=404, detail="Not found")

    # No separate documents:read ability is documented; reuse transfers:read.
    if not user.has_ability("transfers:read"):
        raise HTTPException(status_code=403, detail="Forbidden")

    transfer = await _authorize_transfer(user, id)
    if not transfer:
        raise HTTPException(status_code=404, detail="Not found")

    # Metadata-only query. Avoid file_path and uploaded_by.
    documents_result = await query(
        """
        SELECT id, transfer_id, catalogue_document_id, name, status, notes,
               file_size, file_type, original_file_name, uploaded_at, created_at, updated_at
        FROM transfer_documents
        WHERE transfer_id = $1
        ORDER BY created_at
        """,
        [id],
    )
    documents = [_map_transfer_document(row) for row in documents_result.rows]

    return {"message": "OK", "data": {"documents": documents}}


@router.get("/{id}/financials")
async def get_transfer_financials(
    id: str,
    user: CurrentUser = Depends(require_jwt),
):
    """Retrieve financials for a transfer, scoped to the authorised tenant."""

    # Client financial visibility is not documented. Fail closed.
    if user.is_client:
        raise HTTPException(status_code=404, detail="Not found")

    # No separate financials:read ability is documented; reuse transfers:read.
    if not user.has_ability("transfers:read"):
        raise HTTPException(status_code=403, detail="Forbidden")

    transfer = await _authorize_transfer(user, id)
    if not transfer:
        raise HTTPException(status_code=404, detail="Not found")

    # Anchor the query to the authorised transfer. Do not add
    # accountable_institution_id to transfer_financials in this step.
    financials_result = await query(
        "SELECT * FROM transfer_financials WHERE transfer_id = $1",
        [id],
    )
    financials = (
        _map_transfer_financials(financials_result.rows[0])
        if financials_result.rows
        else None
    )

    return {"message": "OK", "data": {"financials": financials}}


@router.get("/{id}")
async def get_transfer(
    id: str,
    user: CurrentUser = Depends(require_jwt),
):
    """Retrieve a single transfer by ID, scoped to the authorised tenant."""

    # Staff must hold the documented transfers:read ability (handover §4.5).
    # Role 4 (Client) is not in the canonical transfers:read assignment; client
    # access is governed by the GR party rule implemented in _authorize_transfer.
    if not user.is_client and not user.has_ability("transfers:read"):
        raise HTTPException(status_code=403, detail="Forbidden")

    transfer = await _authorize_transfer(user, id)
    if not transfer:
        raise HTTPException(status_code=404, detail="Not found")

    return {"message": "OK", "data": _map_transfer(transfer)}
