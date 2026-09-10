"""SARS TDC01 local foundation routes.

No live SARS integration is performed from these endpoints.
"""

import json
import uuid
from typing import Any, Optional

import asyncpg
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

from auth.current_user import CurrentUser
from auth.dependencies import require_jwt
from auth.policy import is_cross_tenant
from db import query
from repositories import sars as sars_repository
from services import sars_calculation_service
from services.sars_declaration_service import (
    SarsDeclarationServiceError,
    record_declaration,
)
from services.sars_submission_lifecycle_service import (
    SarsSubmissionLifecycleServiceError,
    create_or_refresh_draft,
)
from services.sars_tdc01_readiness_service import check_readiness, check_tdc01_readiness
from utils.validate import is_uuid

router = APIRouter()


async def _authorize_transfer(user: CurrentUser, transfer_id: str) -> Optional[dict]:
    if not is_uuid(transfer_id):
        return None

    cross_tenant = is_cross_tenant(user)
    sql = """
        SELECT id, accountable_institution_id
        FROM transfers
        WHERE id = $1::uuid
    """
    params = [transfer_id]
    if not cross_tenant:
        sql += " AND accountable_institution_id = $2"
        params.append(user.accountable_institution_id)

    result = await query(sql, params)
    return dict(result.rows[0]) if result.rows else None


async def _authorize_transfer_party(
    user: CurrentUser, transfer_id: str, transfer_party_id: str
) -> Optional[dict]:
    if not is_uuid(transfer_party_id):
        return None
    transfer = await _authorize_transfer(user, transfer_id)
    if not transfer:
        return None

    cross_tenant = is_cross_tenant(user)
    sql = """
        SELECT id, transfer_id, accountable_institution_id
        FROM transfer_parties
        WHERE id = $1::uuid AND transfer_id = $2::uuid
    """
    params = [transfer_party_id, transfer_id]
    if not cross_tenant:
        sql += " AND accountable_institution_id = $3"
        params.append(user.accountable_institution_id)

    result = await query(sql, params)
    return dict(result.rows[0]) if result.rows else None


async def _authorize_property_for_transfer(
    user: CurrentUser, transfer_id: str, property_id: str
) -> Optional[dict]:
    if not is_uuid(property_id):
        return None
    transfer = await _authorize_transfer(user, transfer_id)
    if not transfer:
        return None

    # A property must be the transfer's property or linked through matter_properties.
    result = await query(
        """
        SELECT 1
        FROM transfers t
        WHERE t.id = $1::uuid AND t.property_id = $2::uuid
        UNION ALL
        SELECT 1
        FROM matter_properties mp
        JOIN matters m ON m.id = mp.matter_id
        WHERE m.source_record_id = $1::uuid AND mp.property_id = $2::uuid
        LIMIT 1
        """,
        [transfer_id, property_id],
    )
    if not result.rows:
        return None
    return {"transfer_id": transfer_id, "property_id": property_id}


@router.get("/{transfer_id}/sars")
async def get_sars_aggregate(
    transfer_id: str,
    user: CurrentUser = Depends(require_jwt),
):
    """Return the SARS aggregate view for a transfer."""
    if user.is_client:
        raise HTTPException(status_code=404, detail="Not found")
    if not user.has_ability("transfers:read"):
        raise HTTPException(status_code=403, detail="Forbidden")

    transfer = await _authorize_transfer(user, transfer_id)
    if not transfer:
        raise HTTPException(status_code=404, detail="Not found")

    submissions = await sars_repository.get_sars_submissions(transfer_id)
    calculations = await sars_repository.get_latest_sars_calculation(transfer_id)
    party_details = await sars_repository.list_transfer_parties_with_sars_details(transfer_id)
    property_details = await sars_repository.get_sars_property_details(transfer_id)
    readiness = await check_tdc01_readiness(transfer_id)

    data = {
        "transferId": transfer_id,
        "submissions": submissions,
        "latestCalculation": calculations,
        "partyDetails": party_details,
        "propertyDetails": property_details,
        "readiness": readiness,
    }
    return {"message": "OK", "data": data}


@router.put("/{transfer_id}/sars/parties/{transfer_party_id}")
async def put_sars_party_details(
    transfer_id: str,
    transfer_party_id: str,
    body: dict,
    user: CurrentUser = Depends(require_jwt),
):
    """Capture or update SARS transaction facts for a transfer party."""
    if not user.has_ability("transfers:write"):
        raise HTTPException(status_code=403, detail="Forbidden")

    party = await _authorize_transfer_party(user, transfer_id, transfer_party_id)
    if not party:
        raise HTTPException(status_code=404, detail="Not found")

    try:
        result = await sars_repository.upsert_sars_party_details(
            transfer_party_id,
            share_percentage=body.get("share_percentage"),
            is_connected_person=body.get("is_connected_person"),
            fixed_period_years=body.get("fixed_period_years"),
            annual_income=body.get("annual_income"),
            not_registered_for_income_tax=body.get("not_registered_for_income_tax"),
            not_registered_reason=body.get("not_registered_reason"),
            spouse_details=body.get("spouse_details"),
            marital_notes=body.get("marital_notes"),
            acquisition_date=body.get("acquisition_date"),
            original_purchase_price=body.get("original_purchase_price"),
            effective_date_of_transaction=body.get("effective_date_of_transaction"),
            metadata=body.get("metadata"),
            actor_user_id=user.user_id,
        )
    except asyncpg.exceptions.ForeignKeyViolationError:
        raise HTTPException(status_code=400, detail="Unknown transfer party")

    return {"message": "OK", "data": result}


@router.put("/{transfer_id}/sars/properties/{property_id}")
async def put_sars_property_details(
    transfer_id: str,
    property_id: str,
    body: dict,
    user: CurrentUser = Depends(require_jwt),
):
    """Capture or update SARS transaction facts for a property."""
    if not user.has_ability("transfers:write"):
        raise HTTPException(status_code=403, detail="Forbidden")

    property_auth = await _authorize_property_for_transfer(user, transfer_id, property_id)
    if not property_auth:
        raise HTTPException(status_code=404, detail="Not found")

    result = await sars_repository.upsert_sars_property_details(
        transfer_id,
        property_id=property_id if property_id != "null" else None,
        matter_property_id=body.get("matter_property_id"),
        is_enterprise_asset_for_vat=body.get("is_enterprise_asset_for_vat"),
        input_tax_claimed=body.get("input_tax_claimed"),
        property_improvement_indicator=body.get("property_improvement_indicator"),
        bought_by_indicator=body.get("bought_by_indicator"),
        property_usage_indicator=body.get("property_usage_indicator"),
        property_nature_indicator=body.get("property_nature_indicator"),
        other_property_usage_desc=body.get("other_property_usage_desc"),
        other_property_nature_desc=body.get("other_property_nature_desc"),
        income_tax_act_applicable=body.get("income_tax_act_applicable"),
        monthly_rental_value=body.get("monthly_rental_value"),
        land_value=body.get("land_value"),
        occupational_rent=body.get("occupational_rent"),
        improvement_value=body.get("improvement_value"),
        other_consideration=body.get("other_consideration"),
        total_fair_value=body.get("total_fair_value"),
        metadata=body.get("metadata"),
        actor_user_id=user.user_id,
    )
    return {"message": "OK", "data": result}


@router.post("/{transfer_id}/sars/calculate", status_code=201)
async def post_sars_calculate(
    transfer_id: str,
    body: dict,
    user: CurrentUser = Depends(require_jwt),
):
    """Run the DEEDLY SARS transfer-duty estimate and store it."""
    if not user.has_ability("transfers:write"):
        raise HTTPException(status_code=403, detail="Forbidden")

    transfer = await _authorize_transfer(user, transfer_id)
    if not transfer:
        raise HTTPException(status_code=404, detail="Not found")

    try:
        result = await sars_calculation_service.compute_and_persist(
            transfer_id,
            is_vat_transaction=body.get("is_vat_transaction"),
            other_consideration=body.get("other_consideration"),
            penalty_interest=body.get("penalty_interest"),
            actor_user_id=user.user_id,
        )
    except sars_calculation_service.SarsCalculationServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {"message": "Created", "data": result}


@router.post("/{transfer_id}/sars/submissions/draft", status_code=201)
async def post_sars_draft_submission(
    transfer_id: str,
    user: CurrentUser = Depends(require_jwt),
):
    """Create or refresh a local SARS draft submission snapshot."""
    if not user.has_ability("transfers:write"):
        raise HTTPException(status_code=403, detail="Forbidden")

    transfer = await _authorize_transfer(user, transfer_id)
    if not transfer:
        raise HTTPException(status_code=404, detail="Not found")

    try:
        result = await create_or_refresh_draft(
            transfer_id,
            actor_user_id=user.user_id,
        )
    except SarsSubmissionLifecycleServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {"message": "Created", "data": result}


@router.post("/{transfer_id}/sars/submissions/{submission_id}/declarations", status_code=201)
async def post_sars_declaration(
    transfer_id: str,
    submission_id: str,
    body: dict,
    user: CurrentUser = Depends(require_jwt),
):
    """Record a declaration event against a submission."""
    if not user.has_ability("transfers:write"):
        raise HTTPException(status_code=403, detail="Forbidden")

    transfer = await _authorize_transfer(user, transfer_id)
    if not transfer:
        raise HTTPException(status_code=404, detail="Not found")

    if not is_uuid(submission_id):
        raise HTTPException(status_code=404, detail="Not found")

    try:
        result = await record_declaration(
            submission_id,
            declaration_type=body.get("declaration_type"),
            declared_by_party_id=body.get("declared_by_party_id"),
            declared_by_user_id=body.get("declared_by_user_id"),
            declaration_date=body.get("declaration_date"),
            signature_document_id=body.get("signature_document_id"),
            actor_user_id=user.user_id,
        )
    except SarsDeclarationServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    return {"message": "Created", "data": result}


@router.get("/{transfer_id}/sars/readiness")
async def get_sars_readiness(
    transfer_id: str,
    user: CurrentUser = Depends(require_jwt),
):
    """Return the SARS TDC01 readiness blockers for the transfer."""
    if user.is_client:
        raise HTTPException(status_code=404, detail="Not found")
    if not user.has_ability("transfers:read"):
        raise HTTPException(status_code=403, detail="Forbidden")

    transfer = await _authorize_transfer(user, transfer_id)
    if not transfer:
        raise HTTPException(status_code=404, detail="Not found")

    blockers = await check_tdc01_readiness(transfer_id)
    return {"message": "OK", "data": {"ready": not blockers, "blockers": blockers}}
