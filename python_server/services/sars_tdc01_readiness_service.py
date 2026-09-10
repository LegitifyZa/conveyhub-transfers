"""SARS TDC01 readiness check for the local DEEDLY foundation.

Returns a list of blockers. No outbound SARS call is attempted.
"""

from typing import Any, Dict, List, Optional, Union
from uuid import UUID

import repositories.sars as sars_repository
from services.sars_submission_payload_builder import SarsSubmissionPayloadBuilderError, build_payload
from services.sars_tdc01_builder import SarsTdc01BuilderError, build_tdc01_document
from services.sars_tdc01_value_maps import SarsUnresolvedMappingError, SarsValueMapError
from services.sars_xml_validator import validate_payload, validate_tdc01_document


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


async def check_tdc01_readiness(
    transfer_id: Union[UUID, str],
    *,
    submission_id: Optional[Union[UUID, str]] = None,
    form_wizard: Optional[Dict[str, Any]] = None,
    transaction_type: Optional[str] = None,
    td_reference_no: Optional[str] = None,
    golden_records: Optional[Dict[str, Dict[str, Any]]] = None,
    entities_client: Any = None,
    connection: Any = None,
) -> List[Dict[str, Any]]:
    """Return typed TDC01 readiness blockers for a transfer.

    Builds the typed V1.17 document from the immutable payload snapshot and
    validates it against the bundled XSD. Every returned blocker is a dict with
    ``field`` and ``message`` keys.
    """
    blockers: List[Dict[str, Any]] = []

    if submission_id:
        submission = await sars_repository.get_sars_submission(submission_id, connection=connection)
    else:
        submission = await sars_repository.get_active_draft_submission(transfer_id, connection=connection)
    submission = submission or {}

    td_reference_no = td_reference_no or submission.get("sars_reference_no")
    form_wizard = form_wizard or submission.get("submission_payload", {}).get("form_wizard")
    transaction_type = transaction_type or submission.get("submission_payload", {}).get("transaction_type")

    if not td_reference_no:
        blockers.append({"field": "submission.td_reference_no", "message": "TDReferenceNo is required"})
    if not transaction_type:
        blockers.append({"field": "submission.transaction_type", "message": "TransactionType is required"})
    if not form_wizard:
        blockers.append({"field": "submission.form_wizard", "message": "FormWizard is required"})

    if blockers:
        return blockers

    try:
        payload = await build_payload(transfer_id, submission_id=submission_id, connection=connection)
    except SarsSubmissionPayloadBuilderError as exc:
        blockers.append({"field": "submission_payload", "message": f"Unable to build submission payload: {exc}"})
        return blockers

    try:
        document = await build_tdc01_document(
            payload,
            transaction_type=transaction_type,
            td_reference_no=td_reference_no,
            form_wizard=form_wizard,
            golden_records=golden_records,
            entities_client=entities_client,
            submission=submission,
        )
    except SarsTdc01BuilderError as exc:
        blockers.extend(exc.blockers or [{"field": "tdc01", "message": str(exc)}])
        return blockers
    except SarsUnresolvedMappingError as exc:
        blockers.append({"field": exc.target, "message": str(exc)})
        return blockers
    except SarsValueMapError as exc:
        blockers.append({"field": exc.target, "message": str(exc)})
        return blockers

    _check_tdc01_document(document, blockers)

    if blockers:
        return blockers

    result = validate_tdc01_document(document)
    if not result.valid:
        blockers.extend(
            [{"field": "tdc01.xsd", "message": e} for e in result.errors]
            or [{"field": "tdc01.xsd", "message": "XML validation failed"}]
        )

    return blockers


def _check_tdc01_document(document: Any, blockers: List[Dict[str, Any]]) -> None:
    for rep in document.sellers_details + document.purchasers_details:
        if rep.nature_of_person == "UNRESOLVED":
            blockers.append(
                {
                    "field": "party.nature_of_person",
                    "message": "NatureOfPerson is unresolved for a party; supply the authoritative mapping",
                }
            )
    if not document.sellers_details:
        blockers.append({"field": "sellers_details", "message": "At least one seller is required"})
    if not document.purchasers_details:
        blockers.append({"field": "purchasers_details", "message": "At least one purchaser is required"})
    if not document.property_details:
        blockers.append({"field": "property_details", "message": "PropertyDetails is required"})
    if not document.duty_interest_payable:
        blockers.append({"field": "duty_interest_payable", "message": "DutyInterestPayable is required"})
    if not document.conveyancer_details:
        blockers.append({"field": "conveyancer_details", "message": "ConveyancerDetails is required"})
    if not document.sellers_declarations:
        blockers.append({"field": "sellers_declarations", "message": "Seller declarations are required"})
    if not document.purchasers_declarations:
        blockers.append({"field": "purchasers_declarations", "message": "Purchaser declarations are required"})


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
