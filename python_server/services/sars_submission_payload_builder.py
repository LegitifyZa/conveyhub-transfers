"""Build an immutable SARS submission payload snapshot from local DEEDLY data.

This module does **not** make outbound calls. Golden Record identity stored in
``transfer_parties`` display cache is included as the submission-time snapshot.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union
from uuid import UUID

import repositories.sars as sars_repository


class SarsSubmissionPayloadBuilderError(Exception):
    """Raised when a payload cannot be assembled because local data is missing."""

    pass


async def build_payload(
    transfer_id: Union[UUID, str],
    *,
    submission_id: Optional[Union[UUID, str]] = None,
    form_wizard: Optional[Dict[str, Any]] = None,
    transaction_type: Optional[str] = None,
    connection: Any = None,
) -> Dict[str, Any]:
    """Assemble the canonical SARS TDC01 payload for ``transfer_id``.

    The returned dictionary is intended to be stored in
    ``sars_submissions.submission_payload`` as an immutable snapshot.
    ``form_wizard`` and ``transaction_type`` may be supplied by the caller and
    are recorded inside the snapshot; no additional schema is required for the
    local-foundation JSONB capture.
    """
    transfer = await sars_repository.get_transfer_with_property(transfer_id, connection=connection)
    if not transfer:
        raise SarsSubmissionPayloadBuilderError("Transfer not found")

    financials = await sars_repository.get_transfer_financials(transfer_id, connection=connection)
    parties = await sars_repository.list_transfer_parties_with_sars_details(transfer_id, connection=connection)
    property_details = await sars_repository.get_sars_property_details(transfer_id, connection=connection)
    calculation = await sars_repository.get_latest_sars_calculation(transfer_id, connection=connection)
    firm = await sars_repository.get_accountable_institution_firm(
        transfer["accountable_institution_id"], connection=connection
    )

    declarations: List[Dict[str, Any]] = []
    if submission_id:
        declarations = await sars_repository.list_sars_declaration_events(submission_id, connection=connection)

    payload = {
        "snapshot_at": datetime.now(timezone.utc).isoformat(),
        "payload_version": "1.0",
        "form_wizard": form_wizard,
        "transaction_type": transaction_type,
        "ownership_groups": {
            "transfer_matter_sourced": _build_transfer_section(transfer, financials),
            "golden_record_sourced": _build_parties_section(parties),
            "party_specific_sars": _build_party_sars_section(parties),
            "property_specific_sars": _build_property_sars_section(property_details),
            "calculated_values": _build_calculation_section(calculation),
            "declaration_data": _build_declarations_section(declarations),
            "accountable_institution": _build_firm_section(firm),
        },
    }

    return payload


def _build_transfer_section(transfer: Dict[str, Any], financials: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "transfer_id": str(transfer.get("id")),
        "transfer_ref": transfer.get("transfer_id"),
        "property_address": transfer.get("property_address"),
        "purchase_price": _to_float_or_none(transfer.get("purchase_price")),
        "transaction_date": _to_iso_or_none(transfer.get("transaction_date")),
        "registration_date": _to_iso_or_none(transfer.get("registration_date")),
        "status": transfer.get("status"),
        "property_id": str(transfer.get("property_id")) if transfer.get("property_id") else None,
        "erf_number": transfer.get("erf_number"),
        "street_address": transfer.get("street_address"),
        "suburb": transfer.get("suburb"),
        "city": transfer.get("city"),
        "province": transfer.get("province"),
        "postal_code": transfer.get("postal_code"),
        "title_deed_number": transfer.get("title_deed_number"),
        "survey_general_number": transfer.get("survey_general_number"),
        "extent_sqm": _to_float_or_none(transfer.get("extent_sqm")),
        "property_type": transfer.get("property_type"),
        "financials": financials or {},
    }


def _build_parties_section(parties: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {
            "transfer_party_id": str(p["transfer_party_id"]),
            "golden_record_id": str(p["golden_record_id"]) if p.get("golden_record_id") else None,
            "entity_type": p.get("entity_type"),
            "role": p.get("role"),
            "display_name": p.get("cached_name"),
            "display_id_number": p.get("cached_id_number"),
            "display_email": p.get("cached_email"),
        }
        for p in parties
    ]


def _build_party_sars_section(parties: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {
            "transfer_party_id": str(p["transfer_party_id"]),
            "share_percentage": _to_float_or_none(p.get("share_percentage")),
            "is_connected_person": p.get("is_connected_person"),
            "fixed_period_years": p.get("fixed_period_years"),
            "annual_income": _to_float_or_none(p.get("annual_income")),
            "not_registered_for_income_tax": p.get("not_registered_for_income_tax"),
            "not_registered_reason": p.get("not_registered_reason"),
            "spouse_details": p.get("spouse_details") or {},
            "marital_notes": p.get("marital_notes"),
            "acquisition_date": _to_iso_or_none(p.get("acquisition_date")),
            "original_purchase_price": _to_float_or_none(p.get("original_purchase_price")),
            "effective_date_of_transaction": _to_iso_or_none(p.get("effective_date_of_transaction")),
            "metadata": p.get("metadata") or {},
        }
        for p in parties
    ]


def _build_property_sars_section(property_details: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not property_details:
        return {}
    return {
        "property_id": str(property_details.get("property_id")) if property_details.get("property_id") else None,
        "is_enterprise_asset_for_vat": property_details.get("is_enterprise_asset_for_vat"),
        "input_tax_claimed": property_details.get("input_tax_claimed"),
        "property_improvement_indicator": property_details.get("property_improvement_indicator"),
        "bought_by_indicator": property_details.get("bought_by_indicator"),
        "property_usage_indicator": property_details.get("property_usage_indicator"),
        "property_nature_indicator": property_details.get("property_nature_indicator"),
        "other_property_usage_desc": property_details.get("other_property_usage_desc"),
        "other_property_nature_desc": property_details.get("other_property_nature_desc"),
        "income_tax_act_applicable": property_details.get("income_tax_act_applicable"),
        "monthly_rental_value": _to_float_or_none(property_details.get("monthly_rental_value")),
        "land_value": _to_float_or_none(property_details.get("land_value")),
        "occupational_rent": _to_float_or_none(property_details.get("occupational_rent")),
        "improvement_value": _to_float_or_none(property_details.get("improvement_value")),
        "other_consideration": _to_float_or_none(property_details.get("other_consideration")),
        "total_fair_value": _to_float_or_none(property_details.get("total_fair_value")),
        "metadata": property_details.get("metadata") or {},
    }


def _build_calculation_section(calculation: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not calculation:
        return {}
    return {
        "calculation_id": str(calculation.get("id")),
        "version": calculation.get("calculation_version"),
        "purchase_price": _to_float_or_none(calculation.get("purchase_price")),
        "other_consideration": _to_float_or_none(calculation.get("other_consideration")),
        "total_consideration": _to_float_or_none(calculation.get("total_consideration")),
        "transfer_duty_payable": _to_float_or_none(calculation.get("transfer_duty_payable")),
        "is_vat_transaction": calculation.get("is_vat_transaction"),
        "vat_rate_indicator": calculation.get("vat_rate_indicator"),
        "vat_payable": _to_float_or_none(calculation.get("vat_payable")),
        "output_tax_payable": _to_float_or_none(calculation.get("output_tax_payable")),
        "supply_going_concern_payable": _to_float_or_none(calculation.get("supply_going_concern_payable")),
        "sub_total": _to_float_or_none(calculation.get("sub_total")),
        "penalty_interest": _to_float_or_none(calculation.get("penalty_interest")),
        "total_payable": _to_float_or_none(calculation.get("total_payable")),
        "party_allocations": calculation.get("party_allocations") or [],
        "calculation_data": calculation.get("calculation_data") or {},
    }


def _build_declarations_section(declarations: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {
            "declaration_type": d.get("declaration_type"),
            "declared_by_party_id": str(d.get("declared_by_party_id")) if d.get("declared_by_party_id") else None,
            "declared_by_user_id": d.get("declared_by_user_id"),
            "declaration_date": _to_iso_or_none(d.get("declaration_date")),
            "signature_document_id": str(d.get("signature_document_id")) if d.get("signature_document_id") else None,
            "version": d.get("version"),
            "created_at": _to_iso_or_none(d.get("created_at")),
        }
        for d in declarations
    ]


def _build_firm_section(firm: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not firm:
        return {}
    return {
        "firm_name": firm.get("firm_name"),
        "registration_number": firm.get("registration_number"),
        "vat_number": firm.get("vat_number"),
        "is_vat_registered": firm.get("is_vat_registered"),
        "fax": firm.get("fax"),
        "sars_contact_details": firm.get("sars_contact_details") or {},
    }


def _to_float_or_none(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_iso_or_none(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, str):
        return value
    return None
