"""Serialize a typed SarsTdc01Document to deterministic V1.17 XML.

The output is the inner <TransferDutyReturn> document in the SARS namespace.
The outer transport envelope is intentionally out of scope for this module.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Optional
from xml.etree import ElementTree as ET

from models.sars_tdc01 import SarsTdc01Document, SARS_NS

ET.register_namespace("", SARS_NS)


def serialize_tdc01(document: SarsTdc01Document) -> str:
    """Return the deterministic V1.17 XML string for a SarsTdc01Document."""
    root = ET.Element(f"{{{SARS_NS}}}TransferDutyReturn")

    _add_text(root, "TDReferenceNo", document.td_reference_no)
    _add_text(root, "TransactionType", document.transaction_type)

    if document.source_software:
        sw = ET.SubElement(root, f"{{{SARS_NS}}}SourceSoftware")
        _add_text(sw, "Name", document.source_software.name)
        _add_text(sw, "Version", document.source_software.version)

    _add_text(root, "RelatedExchangeDocumentNo", document.related_exchange_document_no)
    _add_text(root, "FinancialAccount", document.financial_account)
    _add_text(root, "TotalFairValueAmt", document.total_fair_value_amt)
    _add_text(root, "AnyOtherConsiderationAmt", document.any_other_consideration_amt)

    if document.sellers_details:
        sellers = ET.SubElement(root, f"{{{SARS_NS}}}SellersDetails")
        for s in document.sellers_details:
            _add_property_representative(sellers, "SellerDetails", s)

    if document.purchasers_details:
        purchasers = ET.SubElement(root, f"{{{SARS_NS}}}PurchasersDetails")
        for p in document.purchasers_details:
            _add_property_representative(purchasers, "PurchaserDetails", p)

    if document.conveyancer_details:
        c = ET.SubElement(root, f"{{{SARS_NS}}}ConveyancerDetails")
        _add_text(c, "ID", document.conveyancer_details.id)
        _add_text(c, "Firm", document.conveyancer_details.firm)
        _add_text(c, "Name", document.conveyancer_details.name)
        _add_text(c, "TelNo", document.conveyancer_details.tel_no)
        _add_text(c, "Email", document.conveyancer_details.email)

    if document.estate_agencies_details:
        agencies = ET.SubElement(root, f"{{{SARS_NS}}}EstateAgenciesDetails")
        for a in document.estate_agencies_details:
            ea = ET.SubElement(agencies, f"{{{SARS_NS}}}EstateAgencyDetails")
            _add_text(ea, "Name", a.name)
            _add_text(ea, "RegistrationNo", a.registration_no)
            _add_text(ea, "VATNo", a.vat_no)
            _add_text(ea, "TelNo", a.tel_no)
            _add_text(ea, "Email", a.email)

    if document.property_details:
        p = ET.SubElement(root, f"{{{SARS_NS}}}PropertyDetails")
        _add_text(p, "VATPurposeInd", document.property_details.vat_purpose_ind)
        _add_text(p, "InputTaxClaimedInd", document.property_details.input_tax_claimed_ind)
        _add_text(p, "TransactionDate", document.property_details.transaction_date)
        _add_text(p, "PropertyImprovementInd", document.property_details.property_improvement_ind)
        _add_text(p, "BoughtByInd", document.property_details.bought_by_ind)
        _add_text(p, "PropertyUsageInd", document.property_details.property_usage_ind)
        _add_text(p, "OtherPropertyUsageDesc", document.property_details.other_property_usage_desc)
        _add_text(p, "PropertyNatureInd", document.property_details.property_nature_ind)
        _add_text(p, "OtherPropertyNatureDesc", document.property_details.other_property_nature_desc)
        _add_text(p, "IncomeTaxActApplicableInd", document.property_details.income_tax_act_applicable_ind)
        _add_text(p, "LocalValuationAmt", document.property_details.local_valuation_amt)
        _add_text(p, "BondAmt", document.property_details.bond_amt)
        _add_text(p, "PropertyValueAmt", document.property_details.property_value_amt)
        _add_text(p, "MonthlyRentalAmt", document.property_details.monthly_rental_amt)
        _add_text(p, "LandValueAmt", document.property_details.land_value_amt)
        _add_text(p, "OccupationalRentAmt", document.property_details.occupational_rent_amt)
        _add_text(p, "ImprovementValueAmt", document.property_details.improvement_value_amt)
        _add_text(p, "SellingPriceAmt", document.property_details.selling_price_amt)
        _add_text(p, "TotalFairAmt", document.property_details.total_fair_amt)
        _add_text(p, "OtherConsiderationAmt", document.property_details.other_consideration_amt)
        _add_text(p, "TotalConsiderationAmt", document.property_details.total_consideration_amt)

    if document.duty_interest_payable:
        d = ET.SubElement(root, f"{{{SARS_NS}}}DutyInterestPayable")
        _add_text(d, "PayableAmt", document.duty_interest_payable.payable_amt)
        if document.duty_interest_payable.natural_persons:
            np = ET.SubElement(d, f"{{{SARS_NS}}}NaturalPersons")
            for item in document.duty_interest_payable.natural_persons:
                _add_duty_interest_item(np, "NaturalPerson", item)
        if document.duty_interest_payable.non_natural_persons:
            np = ET.SubElement(d, f"{{{SARS_NS}}}NonNaturalPersons")
            for item in document.duty_interest_payable.non_natural_persons:
                _add_duty_interest_item(np, "NonNaturalPerson", item)
        _add_text(d, "SubTotalPayableAmt", document.duty_interest_payable.sub_total_payable_amt)
        _add_text(d, "PenaltyInterestAmt", document.duty_interest_payable.penalty_interest_amt)
        _add_text(d, "TotalPayableAmt", document.duty_interest_payable.total_payable_amt)

    if document.vat_payable:
        v = ET.SubElement(root, f"{{{SARS_NS}}}VATPayable")
        _add_text(v, "VATRateInd", document.vat_payable.vat_rate_ind)
        _add_text(v, "IncludingVATInd", document.vat_payable.including_vat_ind)
        _add_text(v, "VATPayableAmt", document.vat_payable.vat_payable_amt)
        _add_text(v, "VATDeclarationPeriod", document.vat_payable.vat_declaration_period)
        _add_text(v, "OutputTaxPayableAmt", document.vat_payable.output_tax_payable_amt)
        _add_text(v, "GoingConcernPayableAmt", document.vat_payable.going_concern_payable_amt)

    if document.transaction_status:
        ts = ET.SubElement(root, f"{{{SARS_NS}}}TransactionStatus")
        _add_text(ts, "Section9Exemption", document.transaction_status.section9_exemption)
        _add_text(ts, "AnotherActExemption", document.transaction_status.another_act_exemption)

    if document.property_descs:
        pd = ET.SubElement(root, f"{{{SARS_NS}}}PropertyDescs")
        for desc in document.property_descs:
            _add_text(pd, "PropertyDesc", desc)

    if document.vdp_application:
        vdp = ET.SubElement(root, f"{{{SARS_NS}}}VDPApplication")
        _add_text(vdp, "VDPIndicator", document.vdp_application.vdp_indicator)
        _add_text(vdp, "VDPApplicationNo", document.vdp_application.vdp_application_no)
        _add_text(vdp, "VDPTransactionReason", document.vdp_application.vdp_transaction_reason)
        _add_text(vdp, "VDPStatus", document.vdp_application.vdp_status)

    if document.sellers_declarations:
        sd = ET.SubElement(root, f"{{{SARS_NS}}}SellersDeclarations")
        for decl in document.sellers_declarations:
            _add_declaration(sd, "SellerDeclaration", decl)

    if document.purchasers_declarations:
        pdecl = ET.SubElement(root, f"{{{SARS_NS}}}PurchasersDeclarations")
        for decl in document.purchasers_declarations:
            _add_declaration(pdecl, "PurchaserDeclaration", decl)

    if document.conveyancer_declaration:
        cd = ET.SubElement(root, f"{{{SARS_NS}}}ConveyancerDeclaration")
        _add_text(cd, "Signature", document.conveyancer_declaration.signature)
        _add_text(cd, "DeclarationDate", document.conveyancer_declaration.declaration_date)

    if document.additional_conveyancer_declaration:
        acd = ET.SubElement(root, f"{{{SARS_NS}}}AdditionalConveyancerDeclaration")
        _add_text(acd, "Signature", document.additional_conveyancer_declaration.signature)
        _add_text(acd, "DeclarationDate", document.additional_conveyancer_declaration.declaration_date)

    _add_text(root, "AssessmentType", document.assessment_type)

    if document.receipt_details:
        r = ET.SubElement(root, f"{{{SARS_NS}}}ReceiptDetails")
        _add_text(r, "ReceiptNo", document.receipt_details.receipt_no)
        _add_text(r, "ReceiptAmt", document.receipt_details.receipt_amt)

    _add_text(root, "RevisionNo", document.revision_no)

    _add_form_wizard(root, document.form_wizard)

    return ET.tostring(root, encoding="unicode")


def _add_property_representative(parent: ET.Element, tag: str, rep: Any) -> None:
    el = ET.SubElement(parent, f"{{{SARS_NS}}}{tag}")
    _add_text(el, "NatureOfPerson", rep.nature_of_person)
    _add_text(el, "DeedsNo", rep.deeds_no)
    _add_text(el, "Fullname", rep.fullname)
    _add_text(el, "Surname", rep.surname)
    _add_text(el, "Initials", rep.initials)
    _add_text(el, "IDNo", rep.id_no)
    _add_text(el, "BirthDate", rep.birth_date)
    _add_text(el, "PassportCountryCode", rep.passport_country_code)
    _add_text(el, "CellNo", rep.cell_no)
    _add_text(el, "PassportNo", rep.passport_no)
    _add_text(el, "IncomeTaxRefNo", rep.income_tax_ref_no)
    _add_text(el, "NotRegForIncomeTaxInd", rep.not_reg_for_income_tax_ind)
    _add_text(el, "NotRegisteredReason", rep.not_registered_reason)
    _add_text(el, "AnnualIncomeAmt", rep.annual_income_amt)
    _add_text(el, "CountryOfResidence", rep.country_of_residence)
    _add_text(el, "VATRefNo", rep.vat_ref_no)
    _add_text(el, "RegistrationNo", rep.registration_no)
    _add_text(el, "NaturalPersonInd", rep.natural_person_ind)
    _add_text(el, "FixedPeriodYears", rep.fixed_period_years)
    _add_text(el, "ConnectedPersonInd", rep.connected_person_ind)
    _add_text(el, "SharePercentage", rep.share_percentage)
    _add_text(el, "Gender", rep.gender)
    _add_text(el, "MaritalStatus", rep.marital_status)
    _add_text(el, "MaritalNotes", rep.marital_notes)
    _add_text(el, "SpouseInitials", rep.spouse_initials)
    _add_text(el, "SpouseIDNo", rep.spouse_id_no)
    _add_text(el, "SpousePassportNo", rep.spouse_passport_no)
    _add_text(el, "SpousePassportCountryCode", rep.spouse_passport_country_code)
    _add_text(el, "AcquisitionDate", rep.acquisition_date)
    _add_text(el, "PurchasePriceAmt", rep.purchase_price_amt)
    _add_text(el, "EffectiveDate", rep.effective_date)


def _add_duty_interest_item(parent: ET.Element, tag: str, item: Any) -> None:
    el = ET.SubElement(parent, f"{{{SARS_NS}}}{tag}")
    _add_text(el, "Percentage", item.percentage)
    _add_text(el, "PayableAmt", item.payable_amt)
    _add_text(el, "CalculatedPayableAmt", item.calculated_payable_amt)


def _add_declaration(parent: ET.Element, tag: str, decl: Any) -> None:
    el = ET.SubElement(parent, f"{{{SARS_NS}}}{tag}")
    _add_text(el, "Signature", decl.signature)
    _add_text(el, "DeclarationDate", decl.declaration_date)


def _add_form_wizard(root: ET.Element, wizard: Any) -> None:
    if not wizard:
        return
    w = ET.SubElement(root, f"{{{SARS_NS}}}FormWizard")
    _add_text(w, "TransferDutyType", wizard.transfer_duty_type)
    _add_text(w, "NormalInd", wizard.normal_ind)
    _add_text(w, "DonationInd", wizard.donation_ind)
    _add_text(w, "ExchangeInd", wizard.exchange_ind)
    _add_text(w, "PatitionInd", wizard.partition_ind)
    _add_text(w, "UsurfructInd", wizard.usufruct_ind)
    _add_text(w, "UsurfructType", wizard.usufruct_type)
    _add_text(w, "BaredominiumInd", wizard.bare_dominium_ind)
    _add_text(w, "BaredominiumType", wizard.bare_dominium_type)
    _add_text(w, "FideicommissiumInd", wizard.fideicommissum_ind)
    _add_text(w, "FideicommissiumType", wizard.fideicommissum_type)
    _add_text(w, "UsusInd", wizard.usus_ind)
    _add_text(w, "UsusType", wizard.usus_type)
    _add_text(w, "HabitatioInd", wizard.habitatio_ind)
    _add_text(w, "HabitatioType", wizard.habitatio_type)
    _add_text(w, "ResidentialPropertyCompanyTransferInd", wizard.residential_property_company_transfer_ind)
    _add_text(w, "ExemptInd", wizard.exempt_ind)
    _add_text(w, "ExemptType", wizard.exempt_type)
    _add_text(w, "NoOfSellers", wizard.no_of_sellers)
    _add_text(w, "NoOfExistingShareholders", wizard.no_of_existing_shareholders)
    _add_text(w, "NoOfBuyers", wizard.no_of_buyers)
    _add_text(w, "NoOfNewShareholders", wizard.no_of_new_shareholders)
    _add_text(w, "NoOfEstateAgents", wizard.no_of_estate_agents)


def _add_text(parent: ET.Element, tag: str, value: Any) -> None:
    """Add a namespaced text element; skip None values."""
    if value is None:
        return
    el = ET.SubElement(parent, f"{{{SARS_NS}}}{tag}")
    el.text = _format_value(value)


def _format_value(value: Any) -> str:
    if isinstance(value, bool):
        return "Y" if value else "N"
    if isinstance(value, Decimal):
        return f"{value:.2f}"
    if isinstance(value, date):
        return value.isoformat()
    return str(value)
