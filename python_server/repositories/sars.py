"""Repository layer for SARS TDC01 foundation tables.

All functions accept an optional ``connection`` so callers can compose them
inside a transaction. Tenant fields are derived by triggers, not from payloads.
"""

import json
from decimal import Decimal
from typing import Any, Dict, List, Optional, Union
from uuid import UUID

import db


async def _get_transfer_tenant(
    transfer_id: Union[UUID, str], connection: Any = None
) -> Optional[int]:
    result = await db.query(
        "SELECT accountable_institution_id FROM transfers WHERE id = $1::uuid",
        [transfer_id],
        connection=connection,
    )
    if not result.rows:
        return None
    return result.rows[0]["accountable_institution_id"]


async def list_transfer_parties_with_sars_details(
    transfer_id: Union[UUID, str], connection: Any = None
) -> List[Dict[str, Any]]:
    result = await db.query(
        """
        SELECT
            tp.id AS transfer_party_id,
            tp.golden_record_id,
            tp.entity_type,
            tp.role,
            tp.cached_name,
            tp.cached_id_number,
            tp.cached_email,
            spd.id AS sars_party_detail_id,
            spd.share_percentage,
            spd.is_connected_person,
            spd.fixed_period_years,
            spd.annual_income,
            spd.not_registered_for_income_tax,
            spd.not_registered_reason,
            spd.spouse_details,
            spd.marital_notes,
            spd.acquisition_date,
            spd.original_purchase_price,
            spd.effective_date_of_transaction,
            spd.metadata
        FROM transfer_parties tp
        LEFT JOIN sars_party_details spd ON spd.transfer_party_id = tp.id
        WHERE tp.transfer_id = $1::uuid
        ORDER BY tp.created_at
        """,
        [transfer_id],
        connection=connection,
    )
    return [dict(r) for r in result.rows]


async def get_sars_party_details(
    transfer_party_id: Union[UUID, str], connection: Any = None
) -> Optional[Dict[str, Any]]:
    result = await db.query(
        "SELECT * FROM sars_party_details WHERE transfer_party_id = $1::uuid",
        [transfer_party_id],
        connection=connection,
    )
    return dict(result.rows[0]) if result.rows else None


async def upsert_sars_party_details(
    transfer_party_id: Union[UUID, str],
    *,
    share_percentage: Optional[Union[int, float, Decimal]] = None,
    is_connected_person: Optional[bool] = None,
    fixed_period_years: Optional[int] = None,
    annual_income: Optional[Union[int, float, Decimal]] = None,
    not_registered_for_income_tax: Optional[bool] = None,
    not_registered_reason: Optional[str] = None,
    spouse_details: Optional[Dict[str, Any]] = None,
    marital_notes: Optional[str] = None,
    acquisition_date: Optional[str] = None,
    original_purchase_price: Optional[Union[int, float, Decimal]] = None,
    effective_date_of_transaction: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    actor_user_id: Optional[int] = None,
    connection: Any = None,
) -> Dict[str, Any]:
    return await _do_upsert_sars_party_details(
        transfer_party_id,
        share_percentage=share_percentage,
        is_connected_person=is_connected_person,
        fixed_period_years=fixed_period_years,
        annual_income=annual_income,
        not_registered_for_income_tax=not_registered_for_income_tax,
        not_registered_reason=not_registered_reason,
        spouse_details=spouse_details,
        marital_notes=marital_notes,
        acquisition_date=acquisition_date,
        original_purchase_price=original_purchase_price,
        effective_date_of_transaction=effective_date_of_transaction,
        metadata=metadata,
        actor_user_id=actor_user_id,
        connection=connection,
    )


async def _do_upsert_sars_party_details(
    transfer_party_id: Union[UUID, str],
    *,
    share_percentage: Optional[Union[int, float, Decimal]] = None,
    is_connected_person: Optional[bool] = None,
    fixed_period_years: Optional[int] = None,
    annual_income: Optional[Union[int, float, Decimal]] = None,
    not_registered_for_income_tax: Optional[bool] = None,
    not_registered_reason: Optional[str] = None,
    spouse_details: Optional[Dict[str, Any]] = None,
    marital_notes: Optional[str] = None,
    acquisition_date: Optional[str] = None,
    original_purchase_price: Optional[Union[int, float, Decimal]] = None,
    effective_date_of_transaction: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
    actor_user_id: Optional[int] = None,
    connection: Any = None,
) -> Dict[str, Any]:
    def _dec(value: Any) -> Optional[Decimal]:
        return Decimal(str(value)) if value is not None else None

    result = await db.query(
        """
        INSERT INTO sars_party_details (
            transfer_party_id,
            share_percentage,
            is_connected_person,
            fixed_period_years,
            annual_income,
            not_registered_for_income_tax,
            not_registered_reason,
            spouse_details,
            marital_notes,
            acquisition_date,
            original_purchase_price,
            effective_date_of_transaction,
            metadata,
            created_by_user_id,
            updated_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13::jsonb, $14, $14)
        ON CONFLICT (transfer_party_id) DO UPDATE SET
            share_percentage = EXCLUDED.share_percentage,
            is_connected_person = EXCLUDED.is_connected_person,
            fixed_period_years = EXCLUDED.fixed_period_years,
            annual_income = EXCLUDED.annual_income,
            not_registered_for_income_tax = EXCLUDED.not_registered_for_income_tax,
            not_registered_reason = EXCLUDED.not_registered_reason,
            spouse_details = EXCLUDED.spouse_details,
            marital_notes = EXCLUDED.marital_notes,
            acquisition_date = EXCLUDED.acquisition_date,
            original_purchase_price = EXCLUDED.original_purchase_price,
            effective_date_of_transaction = EXCLUDED.effective_date_of_transaction,
            metadata = EXCLUDED.metadata,
            updated_by_user_id = EXCLUDED.updated_by_user_id,
            updated_at = CURRENT_TIMESTAMP
        RETURNING *
        """,
        [
            transfer_party_id,
            _dec(share_percentage),
            is_connected_person,
            fixed_period_years,
            _dec(annual_income),
            not_registered_for_income_tax,
            not_registered_reason,
            json.dumps(spouse_details or {}),
            marital_notes,
            acquisition_date,
            _dec(original_purchase_price),
            effective_date_of_transaction,
            json.dumps(metadata or {}),
            actor_user_id,
        ],
        connection=connection,
    )
    if not result.rows:
        raise RuntimeError("Failed to upsert sars_party_details")
    return dict(result.rows[0])


async def get_sars_property_details(
    transfer_id: Union[UUID, str], property_id: Optional[Union[UUID, str]] = None, connection: Any = None
) -> Optional[Dict[str, Any]]:
    if property_id:
        result = await db.query(
            "SELECT * FROM sars_property_details WHERE transfer_id = $1::uuid AND property_id = $2::uuid",
            [transfer_id, property_id],
            connection=connection,
        )
    else:
        result = await db.query(
            "SELECT * FROM sars_property_details WHERE transfer_id = $1::uuid ORDER BY created_at LIMIT 1",
            [transfer_id],
            connection=connection,
        )
    return dict(result.rows[0]) if result.rows else None


async def upsert_sars_property_details(
    transfer_id: Union[UUID, str],
    *,
    property_id: Optional[Union[UUID, str]] = None,
    matter_property_id: Optional[Union[UUID, str]] = None,
    is_enterprise_asset_for_vat: Optional[bool] = None,
    input_tax_claimed: Optional[bool] = None,
    property_improvement_indicator: Optional[str] = None,
    bought_by_indicator: Optional[str] = None,
    property_usage_indicator: Optional[str] = None,
    property_nature_indicator: Optional[str] = None,
    other_property_usage_desc: Optional[str] = None,
    other_property_nature_desc: Optional[str] = None,
    income_tax_act_applicable: Optional[str] = None,
    monthly_rental_value: Optional[Union[int, float, Decimal]] = None,
    land_value: Optional[Union[int, float, Decimal]] = None,
    occupational_rent: Optional[Union[int, float, Decimal]] = None,
    improvement_value: Optional[Union[int, float, Decimal]] = None,
    other_consideration: Optional[Union[int, float, Decimal]] = None,
    total_fair_value: Optional[Union[int, float, Decimal]] = None,
    metadata: Optional[Dict[str, Any]] = None,
    actor_user_id: Optional[int] = None,
    connection: Any = None,
) -> Dict[str, Any]:
    def _dec(value: Any) -> Optional[Decimal]:
        return Decimal(str(value)) if value is not None else None

    result = await db.query(
        """
        INSERT INTO sars_property_details (
            transfer_id,
            property_id,
            matter_property_id,
            is_enterprise_asset_for_vat,
            input_tax_claimed,
            property_improvement_indicator,
            bought_by_indicator,
            property_usage_indicator,
            property_nature_indicator,
            other_property_usage_desc,
            other_property_nature_desc,
            income_tax_act_applicable,
            monthly_rental_value,
            land_value,
            occupational_rent,
            improvement_value,
            other_consideration,
            total_fair_value,
            metadata,
            created_by_user_id,
            updated_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20, $20)
        ON CONFLICT (transfer_id, COALESCE(property_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO UPDATE SET
            matter_property_id = EXCLUDED.matter_property_id,
            is_enterprise_asset_for_vat = EXCLUDED.is_enterprise_asset_for_vat,
            input_tax_claimed = EXCLUDED.input_tax_claimed,
            property_improvement_indicator = EXCLUDED.property_improvement_indicator,
            bought_by_indicator = EXCLUDED.bought_by_indicator,
            property_usage_indicator = EXCLUDED.property_usage_indicator,
            property_nature_indicator = EXCLUDED.property_nature_indicator,
            other_property_usage_desc = EXCLUDED.other_property_usage_desc,
            other_property_nature_desc = EXCLUDED.other_property_nature_desc,
            income_tax_act_applicable = EXCLUDED.income_tax_act_applicable,
            monthly_rental_value = EXCLUDED.monthly_rental_value,
            land_value = EXCLUDED.land_value,
            occupational_rent = EXCLUDED.occupational_rent,
            improvement_value = EXCLUDED.improvement_value,
            other_consideration = EXCLUDED.other_consideration,
            total_fair_value = EXCLUDED.total_fair_value,
            metadata = EXCLUDED.metadata,
            updated_by_user_id = EXCLUDED.updated_by_user_id,
            updated_at = CURRENT_TIMESTAMP
        RETURNING *
        """,
        [
            transfer_id,
            property_id,
            matter_property_id,
            is_enterprise_asset_for_vat,
            input_tax_claimed,
            property_improvement_indicator,
            bought_by_indicator,
            property_usage_indicator,
            property_nature_indicator,
            other_property_usage_desc,
            other_property_nature_desc,
            income_tax_act_applicable,
            _dec(monthly_rental_value),
            _dec(land_value),
            _dec(occupational_rent),
            _dec(improvement_value),
            _dec(other_consideration),
            _dec(total_fair_value),
            json.dumps(metadata or {}),
            actor_user_id,
        ],
        connection=connection,
    )
    if not result.rows:
        raise RuntimeError("Failed to upsert sars_property_details")
    return dict(result.rows[0])


async def get_latest_sars_calculation(
    transfer_id: Union[UUID, str], connection: Any = None
) -> Optional[Dict[str, Any]]:
    result = await db.query(
        """
        SELECT *
        FROM sars_calculations
        WHERE transfer_id = $1::uuid
        ORDER BY created_at DESC
        LIMIT 1
        """,
        [transfer_id],
        connection=connection,
    )
    return dict(result.rows[0]) if result.rows else None


async def get_active_draft_submission(
    transfer_id: Union[UUID, str], connection: Any = None
) -> Optional[Dict[str, Any]]:
    result = await db.query(
        """
        SELECT * FROM sars_submissions
        WHERE transfer_id = $1::uuid AND status = 'draft'
        ORDER BY created_at DESC
        LIMIT 1
        """,
        [transfer_id],
        connection=connection,
    )
    return dict(result.rows[0]) if result.rows else None


async def get_sars_submissions(
    transfer_id: Union[UUID, str], connection: Any = None
) -> List[Dict[str, Any]]:
    result = await db.query(
        "SELECT * FROM sars_submissions WHERE transfer_id = $1::uuid ORDER BY created_at DESC",
        [transfer_id],
        connection=connection,
    )
    return [dict(r) for r in result.rows]


async def get_sars_submission(
    submission_id: Union[UUID, str], connection: Any = None
) -> Optional[Dict[str, Any]]:
    result = await db.query(
        "SELECT * FROM sars_submissions WHERE id = $1::uuid",
        [submission_id],
        connection=connection,
    )
    return dict(result.rows[0]) if result.rows else None


async def create_sars_submission(
    transfer_id: Union[UUID, str],
    *,
    payload_version: str = "1.0",
    submission_payload: Optional[Dict[str, Any]] = None,
    actor_user_id: Optional[int] = None,
    connection: Any = None,
) -> Dict[str, Any]:
    result = await db.query(
        """
        INSERT INTO sars_submissions (
            transfer_id,
            payload_version,
            submission_payload,
            created_by_user_id,
            updated_by_user_id
        )
        VALUES ($1::uuid, $2, $3::jsonb, $4, $4)
        RETURNING *
        """,
        [
            transfer_id,
            payload_version,
            json.dumps(submission_payload or {}),
            actor_user_id,
        ],
        connection=connection,
    )
    if not result.rows:
        raise RuntimeError("Failed to create sars_submission")
    return dict(result.rows[0])


async def update_submission_payload(
    submission_id: Union[UUID, str],
    *,
    submission_payload: Dict[str, Any],
    actor_user_id: Optional[int] = None,
    connection: Any = None,
) -> Dict[str, Any]:
    result = await db.query(
        """
        UPDATE sars_submissions
        SET submission_payload = $2::jsonb,
            updated_by_user_id = $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1::uuid
        RETURNING *
        """,
        [submission_id, json.dumps(submission_payload), actor_user_id],
        connection=connection,
    )
    if not result.rows:
        raise RuntimeError("Failed to update submission payload")
    return dict(result.rows[0])


async def transition_submission_status(
    submission_id: Union[UUID, str],
    *,
    new_status: str,
    actor_user_id: Optional[int] = None,
    connection: Any = None,
) -> Dict[str, Any]:
    columns = {
        "submitted": "submitted_at",
        "assessed": "assessed_at",
        "paid": "paid_at",
    }
    extra = ""
    params = [submission_id, new_status, actor_user_id]
    if new_status in columns:
        params.append(columns[new_status])
        extra = f", {columns[new_status]} = CURRENT_TIMESTAMP"

    result = await db.query(
        f"""
        UPDATE sars_submissions
        SET status = $2,
            updated_by_user_id = $3,
            updated_at = CURRENT_TIMESTAMP
            {extra}
        WHERE id = $1::uuid
        RETURNING *
        """,
        params,
        connection=connection,
    )
    if not result.rows:
        raise RuntimeError("Failed to transition submission status")
    return dict(result.rows[0])


async def create_sars_submission_event(
    submission_id: Union[UUID, str],
    *,
    event_type: str,
    payload: Optional[Dict[str, Any]] = None,
    actor_user_id: Optional[int] = None,
    connection: Any = None,
) -> Dict[str, Any]:
    result = await db.query(
        """
        INSERT INTO sars_submission_events (
            sars_submission_id,
            event_type,
            payload,
            created_by_user_id,
            updated_by_user_id
        )
        VALUES ($1::uuid, $2, $3::jsonb, $4, $4)
        RETURNING *
        """,
        [submission_id, event_type, json.dumps(payload or {}), actor_user_id],
        connection=connection,
    )
    if not result.rows:
        raise RuntimeError("Failed to create sars_submission_event")
    return dict(result.rows[0])


async def list_sars_submission_events(
    submission_id: Union[UUID, str], connection: Any = None
) -> List[Dict[str, Any]]:
    result = await db.query(
        """
        SELECT * FROM sars_submission_events
        WHERE sars_submission_id = $1::uuid
        ORDER BY created_at DESC
        """,
        [submission_id],
        connection=connection,
    )
    return [dict(r) for r in result.rows]


async def create_sars_declaration_event(
    submission_id: Union[UUID, str],
    *,
    declaration_type: str,
    declared_by_party_id: Optional[Union[UUID, str]] = None,
    declared_by_user_id: Optional[int] = None,
    declaration_date: Optional[str] = None,
    signature_document_id: Optional[Union[UUID, str]] = None,
    version: int = 1,
    actor_user_id: Optional[int] = None,
    connection: Any = None,
) -> Dict[str, Any]:
    result = await db.query(
        """
        INSERT INTO sars_declaration_events (
            sars_submission_id,
            declaration_type,
            declared_by_party_id,
            declared_by_user_id,
            declaration_date,
            signature_document_id,
            version,
            created_by_user_id,
            updated_by_user_id
        )
        VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6::uuid, $7, $8, $8)
        RETURNING *
        """,
        [
            submission_id,
            declaration_type,
            declared_by_party_id,
            declared_by_user_id,
            declaration_date,
            signature_document_id,
            version,
            actor_user_id,
        ],
        connection=connection,
    )
    if not result.rows:
        raise RuntimeError("Failed to create sars_declaration_event")
    return dict(result.rows[0])


async def list_sars_declaration_events(
    submission_id: Union[UUID, str], connection: Any = None
) -> List[Dict[str, Any]]:
    result = await db.query(
        """
        SELECT * FROM sars_declaration_events
        WHERE sars_submission_id = $1::uuid
        ORDER BY version DESC, created_at DESC
        """,
        [submission_id],
        connection=connection,
    )
    return [dict(r) for r in result.rows]


async def get_accountable_institution_firm(
    accountable_institution_id: int, connection: Any = None
) -> Optional[Dict[str, Any]]:
    result = await db.query(
        "SELECT * FROM account_firm_settings WHERE accountable_institution_id = $1",
        [accountable_institution_id],
        connection=connection,
    )
    return dict(result.rows[0]) if result.rows else None


async def get_transfer_with_property(
    transfer_id: Union[UUID, str], connection: Any = None
) -> Optional[Dict[str, Any]]:
    result = await db.query(
        """
        SELECT t.*, p.id AS property_id, p.erf_number, p.street_address, p.suburb, p.city,
               p.province, p.postal_code, p.title_deed_number, p.survey_general_number,
               p.extent_sqm, p.property_type
        FROM transfers t
        LEFT JOIN properties p ON p.id = t.property_id
        WHERE t.id = $1::uuid
        """,
        [transfer_id],
        connection=connection,
    )
    return dict(result.rows[0]) if result.rows else None


async def get_transfer_financials(
    transfer_id: Union[UUID, str], connection: Any = None
) -> Optional[Dict[str, Any]]:
    result = await db.query(
        "SELECT * FROM transfer_financials WHERE transfer_id = $1::uuid",
        [transfer_id],
        connection=connection,
    )
    return dict(result.rows[0]) if result.rows else None
