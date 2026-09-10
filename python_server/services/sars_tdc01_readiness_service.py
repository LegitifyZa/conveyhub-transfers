"""SARS TDC01 readiness check for the local DEEDLY foundation.

Returns a list of blockers. No outbound SARS call is attempted.
"""

from typing import Any, Dict, List, Optional, Union
from uuid import UUID

import repositories.sars as sars_repository
from services.sars_submission_payload_builder import SarsSubmissionPayloadBuilderError, build_payload
from services.sars_xml_validator import validate_payload


class SarsTdc01ReadinessServiceError(Exception):
    """Raised for unexpected readiness-service failures."""

    pass


async def check_readiness(
    transfer_id: Union[UUID, str],
    *,
    connection: Any = None,
) -> List[Dict[str, Any]]:
    """Return a list of readiness blockers for the transfer's TDC01 submission.

    Each blocker has ``field`` and ``message`` keys. An empty list means no
    local blockers were detected (this does **not** imply SARS acceptance).
    """
    blockers: List[Dict[str, Any]] = []

    transfer = await sars_repository.get_transfer_with_property(transfer_id, connection=connection)
    if not transfer:
        return [{"field": "transfer_id", "message": "Transfer not found"}]

    parties = await sars_repository.list_transfer_parties_with_sars_details(transfer_id, connection=connection)
    property_details = await sars_repository.get_sars_property_details(transfer_id, connection=connection)
    calculation = await sars_repository.get_latest_sars_calculation(transfer_id, connection=connection)

    _check_transfer(transfer, blockers)
    _check_parties(parties, blockers)
    _check_property(transfer, property_details, blockers)
    _check_calculation(calculation, blockers)
    _check_party_sars_details(parties, blockers)
    await _check_xml_payload(transfer_id, blockers, connection)

    return blockers


def _check_transfer(transfer: Dict[str, Any], blockers: List[Dict[str, Any]]) -> None:
    if transfer.get("status") in ("cancelled",):
        blockers.append({"field": "transfer.status", "message": "Transfer is cancelled"})

    if not transfer.get("purchase_price"):
        blockers.append({"field": "transfer.purchase_price", "message": "Purchase price is required"})


def _check_parties(parties: List[Dict[str, Any]], blockers: List[Dict[str, Any]]) -> None:
    if not parties:
        blockers.append({"field": "transfer_parties", "message": "At least one party is required"})
        return

    seller_roles = {"transferor", "seller"}
    buyer_roles = {"transferee", "buyer"}

    has_seller = any(p.get("role") in seller_roles for p in parties)
    has_buyer = any(p.get("role") in buyer_roles for p in parties)

    if not has_seller:
        blockers.append({"field": "transfer_parties", "message": "At least one seller/transferor party is required"})
    if not has_buyer:
        blockers.append({"field": "transfer_parties", "message": "At least one buyer/transferee party is required"})

    for party in parties:
        if not party.get("golden_record_id"):
            blockers.append(
                {
                    "field": f"transfer_parties[{party.get('transfer_party_id')}].golden_record_id",
                    "message": "Party has no linked Golden Record",
                }
            )


def _check_property(
    transfer: Dict[str, Any],
    property_details: Optional[Dict[str, Any]],
    blockers: List[Dict[str, Any]],
) -> None:
    if not transfer.get("property_id") and not property_details:
        blockers.append({"field": "property", "message": "Transfer has no linked property or SARS property details"})
        return

    if property_details is None:
        blockers.append({"field": "sars_property_details", "message": "SARS property details have not been captured"})
        return

    total_fair_value = property_details.get("total_fair_value") or property_details.get("other_consideration") or 0
    if not total_fair_value and not transfer.get("purchase_price"):
        blockers.append(
            {"field": "sars_property_details.total_fair_value", "message": "Total fair value or purchase price is required"}
        )


def _check_calculation(calculation: Optional[Dict[str, Any]], blockers: List[Dict[str, Any]]) -> None:
    if not calculation:
        blockers.append({"field": "sars_calculations", "message": "A SARS calculation has not been run"})
        return

    if calculation.get("total_payable") is None:
        blockers.append({"field": "sars_calculations.total_payable", "message": "Calculation total payable is missing"})


def _check_party_sars_details(parties: List[Dict[str, Any]], blockers: List[Dict[str, Any]]) -> None:
    total_share = _to_float_or_zero(0)
    for party in parties:
        if party.get("sars_party_detail_id"):
            share = _to_float_or_zero(party.get("share_percentage"))
            total_share += share
        else:
            blockers.append(
                {
                    "field": f"sars_party_details[{party.get('transfer_party_id')}]",
                    "message": "SARS party details have not been captured",
                }
            )

    if parties and abs(total_share - 100) > 0.01:
        blockers.append(
            {
                "field": "sars_party_details.share_percentage",
                "message": f"Party share percentages sum to {total_share}, expected 100",
            }
        )


async def _check_xml_payload(
    transfer_id: Union[UUID, str],
    blockers: List[Dict[str, Any]],
    connection: Any = None,
) -> None:
    try:
        payload = await build_payload(transfer_id, connection=connection)
    except SarsSubmissionPayloadBuilderError:
        blockers.append({"field": "submission_payload", "message": "Unable to build submission payload for XSD validation"})
        return

    result = validate_payload(payload)
    if not result.valid:
        for err in result.errors:
            blockers.append({"field": "submission_payload.xsd", "message": err})


def _to_float_or_zero(value: Any) -> float:
    if value is None:
        return 0.0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0
