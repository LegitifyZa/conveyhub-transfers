"""Build a typed SarsTdc01Document from a DEEDLY SARS payload snapshot.

The builder consumes the output of ``sars_submission_payload_builder.build_payload``
(the immutable ``ownership_groups`` snapshot) and produces a strongly typed
``SarsTdc01Document`` suitable for ``serialize_tdc01``.

Golden Record canonical identity is fetched through ``entities_client`` when
available; otherwise the approved ``cached_*`` display fields are used.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Dict, List, Optional, Union

from models.sars_tdc01 import (
    SarsConveyancer,
    SarsDeclaration,
    SarsDutyInterestItem,
    SarsDutyInterestPayable,
    SarsEstateAgency,
    SarsFormWizard,
    SarsPropertyDetails,
    SarsPropertyRepresentative,
    SarsReceiptDetails,
    SarsSourceSoftware,
    SarsTdc01Document,
    SarsTransactionStatus,
    SarsVatPayable,
    SarsVdpApplication,
)
from services.sars_tdc01_value_maps import (
    SarsUnresolvedMappingError,
    SarsValueMapError,
    marital_status,
    gender,
    map_nature_of_person,
    normalize_country,
    normalize_email,
    normalize_id_number,
    normalize_passport,
    normalize_tax_ref,
    normalize_telephone,
    normalize_td_reference,
    to_date,
    to_financial,
    to_int,
    to_percentage,
    validate_transfer_duty_type,
    validate_vat_rate_ind,
    yes_no,
)


class SarsTdc01BuilderError(Exception):
    """Raised when the typed TDC01 document cannot be assembled."""

    def __init__(self, message: str, *, blockers: Optional[List[str]] = None) -> None:
        super().__init__(message)
        self.blockers = list(blockers or [])


async def build_tdc01_document(
    payload: Dict[str, Any],
    *,
    transaction_type: Optional[str] = None,
    td_reference_no: Optional[str] = None,
    form_wizard: Optional[Dict[str, Any]] = None,
    golden_records: Optional[Dict[str, Dict[str, Any]]] = None,
    entities_client: Any = None,
    submission: Optional[Dict[str, Any]] = None,
) -> SarsTdc01Document:
    """Build a SarsTdc01Document from the canonical payload snapshot.

    ``transaction_type`` and ``td_reference_no`` are required external SARS
    contract gates. ``transaction_type`` is passed through as the SARS
    DescriptionTextType; no authoritative DEEDLY-to-SARS vocabulary is assumed.
    ``td_reference_no`` must be supplied by the caller; the initial allocation
    lifecycle is unresolved, so this gate remains closed until the number is
    available. ``form_wizard`` should be the dict of wizard answers used to
    determine the V1.17 wizard structure. ``golden_records`` may provide
    canonical identity data by golden_record_id; otherwise ``entities_client``
    is consulted for person records. Company and trust parties remain an
    explicit unresolved ``NatureOfPerson`` gate.
    """
    groups = payload.get("ownership_groups", {})
    transfer = groups.get("transfer_matter_sourced", {}) or {}
    parties = groups.get("golden_record_sourced", []) or []
    party_sars = groups.get("party_specific_sars", []) or []
    property_sars = groups.get("property_specific_sars", {}) or {}
    calc = groups.get("calculated_values", {}) or {}
    declarations = groups.get("declaration_data", []) or []
    firm = groups.get("accountable_institution", {}) or {}

    submission = submission or {}
    form_wizard = form_wizard or payload.get("form_wizard") or submission.get("form_wizard") or {}
    transaction_type = transaction_type or payload.get("transaction_type")
    td_reference_no = td_reference_no or submission.get("sars_reference_no")

    if not td_reference_no:
        raise SarsTdc01BuilderError("TDReferenceNo is required", blockers=["missing_td_reference_no"])
    if not transaction_type:
        raise SarsTdc01BuilderError("TransactionType is required", blockers=["missing_transaction_type"])
    if not normalize_td_reference(td_reference_no):
        raise SarsTdc01BuilderError("TDReferenceNo format is invalid", blockers=["invalid_td_reference_no"])

    # Resolve canonical Golden Records for person parties (non-person remains
    # an explicit unresolved gate until the authoritative mapping is supplied).
    golden_records = dict(golden_records or {})
    for party in parties:
        grid = party.get("golden_record_id")
        if not grid or grid in golden_records:
            continue
        entity_type = (party.get("entity_type") or "").lower()
        if entity_type == "person" and entities_client is not None:
            golden_records[grid] = await entities_client.get_entity(grid, "person")

    unresolved: list[str] = []
    sellers: list[SarsPropertyRepresentative] = []
    purchasers: list[SarsPropertyRepresentative] = []

    for p in parties:
        try:
            rep = _build_representative(p, party_sars, golden_records)
        except SarsUnresolvedMappingError as exc:
            unresolved.append(
                f"nature_of_person_unresolved:entity_type={p.get('entity_type')}:"
                f"golden_record_id={p.get('golden_record_id')}:reason={exc}"
            )
            continue
        if p.get("role") == "transferor":
            sellers.append(rep)
        elif p.get("role") == "transferee":
            purchasers.append(rep)

    if unresolved:
        raise SarsTdc01BuilderError(
            "NatureOfPerson unresolved for one or more parties",
            blockers=unresolved,
        )

    if not sellers:
        raise SarsTdc01BuilderError("No seller party found in payload", blockers=["missing_sellers"])
    if not purchasers:
        raise SarsTdc01BuilderError("No purchaser party found in payload", blockers=["missing_purchasers"])

    property_details = _build_property_details(transfer, property_sars)
    duty_interest = _build_duty_interest(calc, sellers + purchasers)
    vat = _build_vat(calc)
    conveyancer = _build_conveyancer(firm)
    declarations_map = _build_declarations(declarations, sellers, purchasers)
    wizard = _build_form_wizard(form_wizard, sellers, purchasers)

    doc = SarsTdc01Document(
        td_reference_no=td_reference_no,
        transaction_type=transaction_type,
        form_wizard=wizard,
        source_software=_build_source_software(),
        related_exchange_document_no=_safe(submission.get("related_exchange_sars_reference_no")),
        total_fair_value_amt=to_financial(property_sars.get("total_fair_value") or calc.get("total_consideration")),
        any_other_consideration_amt=to_financial(property_sars.get("other_consideration") or calc.get("other_consideration")),
        sellers_details=sellers,
        purchasers_details=purchasers,
        conveyancer_details=conveyancer,
        property_details=property_details,
        duty_interest_payable=duty_interest,
        vat_payable=vat,
        transaction_status=SarsTransactionStatus(
            section9_exemption=_safe(submission.get("exemption_section9")),
            another_act_exemption=_safe(submission.get("exemption_other_act")),
        ) if submission.get("exemption_section9") or submission.get("exemption_other_act") else None,
        property_descs=[_property_desc(transfer)] if _property_desc(transfer) else [],
        vdp_application=_build_vdp(submission),
        sellers_declarations=declarations_map.get("seller", []),
        purchasers_declarations=declarations_map.get("purchaser", []),
        conveyancer_declaration=declarations_map.get("conveyancer"),
        additional_conveyancer_declaration=declarations_map.get("additional_conveyancer"),
        receipt_details=_build_receipt(submission),
        revision_no=to_int(submission.get("revision_no")),
    )
    return doc


def _build_representative(
    party: Dict[str, Any],
    party_sars: List[Dict[str, Any]],
    golden_records: Dict[str, Dict[str, Any]],
) -> SarsPropertyRepresentative:
    sars = next((s for s in party_sars if s.get("transfer_party_id") == party.get("transfer_party_id")), {})
    grid = party.get("golden_record_id")
    gr = golden_records.get(grid) or {}

    entity_type = (party.get("entity_type") or "").lower()
    nature = map_nature_of_person(entity_type, gr)

    spouse = sars.get("spouse_details") or {}
    return SarsPropertyRepresentative(
        nature_of_person=nature,
        fullname=_safe(party.get("display_name")),
        surname=_extract_surname(gr) or _surname_from_display(party.get("display_name")),
        initials=_extract_initials(gr) or _initials_from_display(party.get("display_name")),
        id_no=normalize_id_number(gr.get("identity_number") or gr.get("id_number") or party.get("display_id_number")),
        birth_date=to_date(gr.get("date_of_birth")),
        passport_country_code=normalize_country(gr.get("passport_country") or sars.get("passport_country_code")),
        cell_no=normalize_telephone(gr.get("cell_phone") or gr.get("phone")),
        passport_no=normalize_passport(gr.get("passport_number") or sars.get("passport_no")),
        income_tax_ref_no=normalize_tax_ref(gr.get("income_tax_number") or gr.get("tax_number") or sars.get("income_tax_ref_no")),
        not_reg_for_income_tax_ind=_bool(sars.get("not_registered_for_income_tax")),
        not_registered_reason=_not_registered_reason(sars.get("not_registered_reason")),
        annual_income_amt=to_financial(sars.get("annual_income")),
        country_of_residence=_safe(gr.get("country_of_residence") or sars.get("country_of_residence")),
        vat_ref_no=normalize_tax_ref(gr.get("vat_number") or sars.get("vat_ref_no")),
        registration_no=_safe(gr.get("registration_number") or sars.get("registration_no")),
        natural_person_ind=(entity_type == "person") or None,
        fixed_period_years=to_int(sars.get("fixed_period_years")),
        connected_person_ind=_bool(sars.get("is_connected_person")),
        share_percentage=to_percentage(sars.get("share_percentage")),
        gender=gender(gr.get("gender") or sars.get("gender")),
        marital_status=marital_status(gr.get("marital_status") or sars.get("marital_status")),
        marital_notes=_safe(sars.get("marital_notes")),
        spouse_initials=_safe(spouse.get("initials")),
        spouse_id_no=normalize_id_number(spouse.get("id_no")),
        spouse_passport_no=normalize_passport(spouse.get("passport_no")),
        spouse_passport_country_code=normalize_country(spouse.get("passport_country_code")),
        acquisition_date=to_date(sars.get("acquisition_date")),
        purchase_price_amt=to_financial(sars.get("original_purchase_price")),
        effective_date=to_date(sars.get("effective_date_of_transaction")),
        email=normalize_email(gr.get("email") or party.get("display_email")),
        is_donation_ind=_bool(sars.get("metadata", {}).get("is_donation")),
        is_property_owner=_bool(sars.get("metadata", {}).get("is_property_owner")),
        is_paying_all_duties=_bool(sars.get("metadata", {}).get("is_paying_all_duties")),
        conveyancing_fees=to_financial(sars.get("metadata", {}).get("conveyancing_fees")),
        identity_type=_safe(sars.get("metadata", {}).get("identity_type")),
        country_code=normalize_country(sars.get("metadata", {}).get("country_code")),
        is_government_vendor=_bool(sars.get("metadata", {}).get("is_government_vendor")),
    )


def _extract_surname(gr: Dict[str, Any]) -> Optional[str]:
    return _safe(gr.get("surname") or gr.get("last_name"))


def _extract_initials(gr: Dict[str, Any]) -> Optional[str]:
    if gr.get("initials"):
        return str(gr["initials"]).strip()[:10]
    first = (gr.get("first_name") or "").strip()
    if not first:
        return None
    return "".join(part[0] for part in first.split() if part)


def _surname_from_display(display: Optional[str]) -> Optional[str]:
    if not display:
        return None
    return str(display).strip().split()[-1]


def _initials_from_display(display: Optional[str]) -> Optional[str]:
    if not display:
        return None
    parts = str(display).strip().split()
    if len(parts) < 2:
        return None
    return "".join(part[0] for part in parts[:-1])


def _build_property_details(transfer: Dict[str, Any], sars: Dict[str, Any]) -> SarsPropertyDetails:
    return SarsPropertyDetails(
        vat_purpose_ind=_bool(sars.get("is_enterprise_asset_for_vat")),
        input_tax_claimed_ind=_bool(sars.get("input_tax_claimed")),
        transaction_date=to_date(transfer.get("transaction_date") or transfer.get("registration_date")),
        property_improvement_ind=_indicator(sars.get("property_improvement_indicator")),
        bought_by_ind=_indicator(sars.get("bought_by_indicator")),
        property_usage_ind=_indicator(sars.get("property_usage_indicator")),
        other_property_usage_desc=_safe(sars.get("other_property_usage_desc")),
        property_nature_ind=_indicator(sars.get("property_nature_indicator")),
        other_property_nature_desc=_safe(sars.get("other_property_nature_desc")),
        income_tax_act_applicable_ind=_bool(sars.get("income_tax_act_applicable")),
        local_valuation_amt=to_financial(sars.get("local_valuation")),
        bond_amt=to_financial(sars.get("bond_amount")),
        property_value_amt=to_financial(sars.get("property_value")),
        monthly_rental_amt=to_financial(sars.get("monthly_rental_value")),
        land_value_amt=to_financial(sars.get("land_value")),
        occupational_rent_amt=to_financial(sars.get("occupational_rent")),
        improvement_value_amt=to_financial(sars.get("improvement_value")),
        selling_price_amt=to_financial(transfer.get("purchase_price")),
        total_fair_amt=to_financial(sars.get("total_fair_value")),
        other_consideration_amt=to_financial(sars.get("other_consideration")),
        total_consideration_amt=to_financial(sars.get("total_consideration")),
    )


def _build_duty_interest(calc: Dict[str, Any], parties: List[SarsPropertyRepresentative]) -> Optional[SarsDutyInterestPayable]:
    duty = to_financial(calc.get("transfer_duty_payable"))
    if duty is None:
        return None

    natural: List[SarsDutyInterestItem] = []
    non_natural: List[SarsDutyInterestItem] = []
    for p in parties:
        if p.nature_of_person == "UNRESOLVED":
            continue
        share = p.share_percentage or Decimal("100.00")
        item = SarsDutyInterestItem(
            percentage=share,
            payable_amt=(duty * share / Decimal("100.00")).quantize(Decimal("0.00")),
            calculated_payable_amt=(duty * share / Decimal("100.00")).quantize(Decimal("0.00")),
        )
        if p.nature_of_person == "INDIVIDUAL":
            natural.append(item)
        else:
            non_natural.append(item)

    return SarsDutyInterestPayable(
        payable_amt=duty,
        natural_persons=natural,
        non_natural_persons=non_natural,
        sub_total_payable_amt=to_financial(calc.get("sub_total") or calc.get("transfer_duty_payable")),
        penalty_interest_amt=to_financial(calc.get("penalty_interest")),
        total_payable_amt=to_financial(calc.get("total_payable") or calc.get("transfer_duty_payable")),
    )


def _build_vat(calc: Dict[str, Any]) -> Optional[SarsVatPayable]:
    if not _bool(calc.get("is_vat_transaction")):
        return None
    return SarsVatPayable(
        vat_rate_ind=validate_vat_rate_ind(calc.get("vat_rate_indicator")),
        including_vat_ind=True,
        vat_payable_amt=to_financial(calc.get("vat_payable")),
        vat_declaration_period=_safe(calc.get("vat_declaration_period")),
        output_tax_payable_amt=to_financial(calc.get("output_tax_payable")),
        going_concern_payable_amt=to_financial(calc.get("supply_going_concern_payable")),
    )


def _build_conveyancer(firm: Dict[str, Any]) -> SarsConveyancer:
    details = firm.get("sars_contact_details") or {}
    return SarsConveyancer(
        firm=_safe(firm.get("firm_name") or firm.get("name") or "Conveyancer"),
        name=_safe(details.get("contact_name") or firm.get("firm_name") or firm.get("name") or "Conveyancer"),
        id=_safe(details.get("reference") or firm.get("registration_number")),
        tel_no=normalize_telephone(details.get("phone") or firm.get("fax")),
        email=normalize_email(details.get("email")),
    )


def _build_declarations(
    declarations: List[Dict[str, Any]],
    sellers: List[SarsPropertyRepresentative],
    purchasers: List[SarsPropertyRepresentative],
) -> Dict[str, Any]:
    result: Dict[str, Any] = {"seller": [], "purchaser": []}
    for decl in declarations:
        d = SarsDeclaration(
            signature=None,  # declaration signature semantics unresolved
            declaration_date=to_date(decl.get("declaration_date") or decl.get("created_at")),
        )
        t = (decl.get("declaration_type") or "").lower()
        if t == "seller":
            result["seller"].append(d)
        elif t == "purchaser":
            result["purchaser"].append(d)
        elif t == "conveyancer":
            result["conveyancer"] = d
        elif t == "additional_conveyancer":
            result["additional_conveyancer"] = d
    # Provide one declaration per party if none was recorded; signature remains
    # unresolved and readiness will report it.
    if not result["seller"]:
        result["seller"] = [SarsDeclaration() for _ in sellers]
    if not result["purchaser"]:
        result["purchaser"] = [SarsDeclaration() for _ in purchasers]
    return result


def _build_form_wizard(form_wizard: Dict[str, Any], sellers: List[SarsPropertyRepresentative], purchasers: List[SarsPropertyRepresentative]) -> SarsFormWizard:
    return SarsFormWizard(
        transfer_duty_type=validate_transfer_duty_type(form_wizard.get("transfer_duty_type") or "UNIDIVIDED_PROPERTY_TRANSFER"),
        normal_ind=_bool(form_wizard.get("normal")),
        donation_ind=_bool(form_wizard.get("donation")),
        exchange_ind=_bool(form_wizard.get("exchange")),
        partition_ind=_bool(form_wizard.get("partition")),
        usufruct_ind=_bool(form_wizard.get("usufruct")),
        usufruct_type=_safe(form_wizard.get("usufruct_type")),
        bare_dominium_ind=_bool(form_wizard.get("bare_dominium")),
        bare_dominium_type=_safe(form_wizard.get("bare_dominium_type")),
        fideicommissum_ind=_bool(form_wizard.get("fideicommissum")),
        fideicommissum_type=_safe(form_wizard.get("fideicommissum_type")),
        usus_ind=_bool(form_wizard.get("usus")),
        usus_type=_safe(form_wizard.get("usus_type")),
        habitatio_ind=_bool(form_wizard.get("habitatio")),
        habitatio_type=_safe(form_wizard.get("habitatio_type")),
        residential_property_company_transfer_ind=_bool(form_wizard.get("residential_property_company_transfer")),
        exempt_ind=_bool(form_wizard.get("exempt")),
        exempt_type=_safe(form_wizard.get("exempt_type")),
        no_of_sellers=to_int(form_wizard.get("no_of_sellers") or len(sellers)),
        no_of_existing_shareholders=to_int(form_wizard.get("no_of_existing_shareholders")),
        no_of_buyers=to_int(form_wizard.get("no_of_buyers") or len(purchasers)),
        no_of_new_shareholders=to_int(form_wizard.get("no_of_new_shareholders")),
        no_of_estate_agents=to_int(form_wizard.get("no_of_estate_agents")),
    )


def _build_source_software() -> SarsSourceSoftware:
    from config import load_settings
    s = load_settings()
    return SarsSourceSoftware(name=s.app_name, version=s.app_version[:10])


def _build_receipt(submission: Dict[str, Any]) -> Optional[SarsReceiptDetails]:
    if not submission.get("receipt_no"):
        return None
    return SarsReceiptDetails(
        receipt_no=_safe(submission.get("receipt_no")),
        receipt_amt=to_financial(submission.get("receipt_amount")),
    )


def _build_vdp(submission: Dict[str, Any]) -> Optional[SarsVdpApplication]:
    if not _bool(submission.get("vdp_indicator")):
        return None
    return SarsVdpApplication(
        vdp_indicator=True,
        vdp_application_no=_safe(submission.get("vdp_application_no")),
        vdp_transaction_reason=_safe(submission.get("vdp_transaction_reason")),
        vdp_status=_safe(submission.get("vdp_status")),
    )


def _property_desc(transfer: Dict[str, Any]) -> Optional[str]:
    return _safe(transfer.get("property_address"))


def _safe(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def _bool(value: Any) -> Optional[bool]:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "y", "yes"}
    if isinstance(value, (int, float)):
        return bool(value)
    return None


def _indicator(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    return s[:1] if s else None


def _not_registered_reason(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    if s in {"MINOR", "UNEMPLOYED", "EARNING_UNDER_THE_INCOME_TAX_THRESHOLD", "DIVORCE_ORDER", " FOREIGN_INDIVIDUAL"}:
        return s
    if s.upper() == "FOREIGN_INDIVIDUAL":
        return " FOREIGN_INDIVIDUAL"
    return None
