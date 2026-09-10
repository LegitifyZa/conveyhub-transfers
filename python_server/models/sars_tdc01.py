"""Typed SARS TDC01 V1.17 document model.

This module intentionally models only the structures required for the DEEDLY
Launch 0 TDC01 standard transfer path. Every field that corresponds to a SARS
XSD element is optional unless the XSD marks it as required.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import List, Optional


SARS_NS = "http://www.sars.gov.za/enterpriseMessagingModel/TransferDutyReturn/xml/schemas/version/1.13"


@dataclass
class SarsSourceSoftware:
    name: str
    version: str


@dataclass
class SarsContactNo:
    phone_type_code: Optional[str] = None
    phone_no: Optional[str] = None
    cell_no: Optional[str] = None
    phone_no_int: Optional[str] = None


@dataclass
class SarsAddress:
    unit_no: Optional[str] = None
    complex: Optional[str] = None
    street_no: Optional[str] = None
    street_farm_name: Optional[str] = None
    suburb_district: Optional[str] = None
    city_town: Optional[str] = None
    post_code: Optional[str] = None
    country_code: Optional[str] = None
    postal_address_same_as_street: Optional[bool] = None
    care_of_name: Optional[str] = None
    po_box_indicator: Optional[bool] = None
    po_box: Optional[str] = None
    postal_code: Optional[str] = None


@dataclass
class SarsPropertyRepresentative:
    nature_of_person: str
    deeds_no: Optional[str] = None
    fullname: Optional[str] = None
    surname: Optional[str] = None
    initials: Optional[str] = None
    id_no: Optional[str] = None
    birth_date: Optional[date] = None
    passport_country_code: Optional[str] = None
    cell_no: Optional[str] = None
    passport_no: Optional[str] = None
    income_tax_ref_no: Optional[str] = None
    not_reg_for_income_tax_ind: Optional[bool] = None
    not_registered_reason: Optional[str] = None
    annual_income_amt: Optional[Decimal] = None
    country_of_residence: Optional[str] = None
    vat_ref_no: Optional[str] = None
    registration_no: Optional[str] = None
    natural_person_ind: Optional[bool] = None
    fixed_period_years: Optional[int] = None
    connected_person_ind: Optional[bool] = None
    share_percentage: Optional[Decimal] = None
    gender: Optional[str] = None
    marital_status: Optional[str] = None
    marital_notes: Optional[str] = None
    spouse_initials: Optional[str] = None
    spouse_id_no: Optional[str] = None
    spouse_passport_no: Optional[str] = None
    spouse_passport_country_code: Optional[str] = None
    acquisition_date: Optional[date] = None
    purchase_price_amt: Optional[Decimal] = None
    effective_date: Optional[date] = None
    contact_nos: List[SarsContactNo] = field(default_factory=list)
    address: Optional[SarsAddress] = None
    taxpayer_portal_role: Optional[str] = None
    is_paying_all_duties: Optional[bool] = None
    conveyancing_fees: Optional[Decimal] = None
    employer_name: Optional[str] = None
    is_property_owner: Optional[bool] = None
    is_donation_ind: Optional[bool] = None
    email: Optional[str] = None
    is_government_vendor: Optional[bool] = None
    identity_type: Optional[str] = None
    country_code: Optional[str] = None


@dataclass
class SarsConveyancer:
    firm: str
    name: str
    id: Optional[str] = None
    tel_no: Optional[str] = None
    email: Optional[str] = None


@dataclass
class SarsEstateAgency:
    name: str
    registration_no: Optional[str] = None
    vat_no: Optional[str] = None
    tel_no: Optional[str] = None
    email: Optional[str] = None


@dataclass
class SarsPropertyDetails:
    selling_price_amt: Decimal
    vat_purpose_ind: Optional[bool] = None
    input_tax_claimed_ind: Optional[bool] = None
    transaction_date: Optional[date] = None
    property_improvement_ind: Optional[str] = None
    bought_by_ind: Optional[str] = None
    property_usage_ind: Optional[str] = None
    other_property_usage_desc: Optional[str] = None
    property_nature_ind: Optional[str] = None
    other_property_nature_desc: Optional[str] = None
    income_tax_act_applicable_ind: Optional[bool] = None
    local_valuation_amt: Optional[Decimal] = None
    bond_amt: Optional[Decimal] = None
    property_value_amt: Optional[Decimal] = None
    monthly_rental_amt: Optional[Decimal] = None
    land_value_amt: Optional[Decimal] = None
    occupational_rent_amt: Optional[Decimal] = None
    improvement_value_amt: Optional[Decimal] = None
    total_fair_amt: Optional[Decimal] = None
    other_consideration_amt: Optional[Decimal] = None
    total_consideration_amt: Optional[Decimal] = None


@dataclass
class SarsDutyInterestItem:
    percentage: Decimal
    payable_amt: Decimal
    calculated_payable_amt: Decimal


@dataclass
class SarsDutyInterestPayable:
    payable_amt: Optional[Decimal] = None
    natural_persons: List[SarsDutyInterestItem] = field(default_factory=list)
    non_natural_persons: List[SarsDutyInterestItem] = field(default_factory=list)
    sub_total_payable_amt: Optional[Decimal] = None
    penalty_interest_amt: Optional[Decimal] = None
    total_payable_amt: Optional[Decimal] = None


@dataclass
class SarsVatPayable:
    vat_rate_ind: Optional[str] = None
    including_vat_ind: Optional[bool] = None
    vat_payable_amt: Optional[Decimal] = None
    vat_declaration_period: Optional[str] = None
    output_tax_payable_amt: Optional[Decimal] = None
    going_concern_payable_amt: Optional[Decimal] = None


@dataclass
class SarsTransactionStatus:
    section9_exemption: Optional[str] = None
    another_act_exemption: Optional[str] = None


@dataclass
class SarsDeclaration:
    signature: Optional[str] = None
    declaration_date: Optional[date] = None


@dataclass
class SarsReceiptDetails:
    receipt_no: Optional[str] = None
    receipt_amt: Optional[Decimal] = None


@dataclass
class SarsVdpApplication:
    vdp_indicator: Optional[bool] = None
    vdp_application_no: Optional[str] = None
    vdp_transaction_reason: Optional[str] = None
    vdp_status: Optional[str] = None


@dataclass
class SarsFormWizard:
    transfer_duty_type: Optional[str] = None
    normal_ind: Optional[bool] = None
    donation_ind: Optional[bool] = None
    exchange_ind: Optional[bool] = None
    partition_ind: Optional[bool] = None
    usufruct_ind: Optional[bool] = None
    usufruct_type: Optional[str] = None
    bare_dominium_ind: Optional[bool] = None
    bare_dominium_type: Optional[str] = None
    fideicommissum_ind: Optional[bool] = None
    fideicommissum_type: Optional[str] = None
    usus_ind: Optional[bool] = None
    usus_type: Optional[str] = None
    habitatio_ind: Optional[bool] = None
    habitatio_type: Optional[str] = None
    residential_property_company_transfer_ind: Optional[bool] = None
    exempt_ind: Optional[bool] = None
    exempt_type: Optional[str] = None
    no_of_sellers: Optional[int] = None
    no_of_existing_shareholders: Optional[int] = None
    no_of_buyers: Optional[int] = None
    no_of_new_shareholders: Optional[int] = None
    no_of_estate_agents: Optional[int] = None


@dataclass
class SarsFormInfo:
    form_number: Optional[str] = None
    form_name: Optional[str] = None
    version_no: Optional[str] = None
    language_code: Optional[str] = None


@dataclass
class SarsSecurityInfo:
    user_id: Optional[str] = None
    password: Optional[str] = None
    digital_certificate: Optional[str] = None


@dataclass
class SarsMetadata:
    keys: List[str] = field(default_factory=list)
    values: List[str] = field(default_factory=list)


@dataclass
class SarsTdc01Document:
    td_reference_no: str
    transaction_type: str
    form_wizard: SarsFormWizard
    source_software: Optional[SarsSourceSoftware] = None
    related_exchange_document_no: Optional[str] = None
    financial_account: Optional[str] = None
    total_fair_value_amt: Optional[Decimal] = None
    any_other_consideration_amt: Optional[Decimal] = None
    sellers_details: List[SarsPropertyRepresentative] = field(default_factory=list)
    purchasers_details: List[SarsPropertyRepresentative] = field(default_factory=list)
    conveyancer_details: Optional[SarsConveyancer] = None
    estate_agencies_details: List[SarsEstateAgency] = field(default_factory=list)
    property_details: Optional[SarsPropertyDetails] = None
    duty_interest_payable: Optional[SarsDutyInterestPayable] = None
    vat_payable: Optional[SarsVatPayable] = None
    transaction_status: Optional[SarsTransactionStatus] = None
    property_descs: List[str] = field(default_factory=list)
    vdp_application: Optional[SarsVdpApplication] = None
    sellers_declarations: List[SarsDeclaration] = field(default_factory=list)
    purchasers_declarations: List[SarsDeclaration] = field(default_factory=list)
    conveyancer_declaration: Optional[SarsDeclaration] = None
    additional_conveyancer_declaration: Optional[SarsDeclaration] = None
    assessment_type: Optional[str] = None
    receipt_details: Optional[SarsReceiptDetails] = None
    revision_no: Optional[int] = None
    form_info: Optional[SarsFormInfo] = None
    security_info: Optional[SarsSecurityInfo] = None
    metadata: Optional[SarsMetadata] = None
