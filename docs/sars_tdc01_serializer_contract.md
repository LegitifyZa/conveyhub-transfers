# SARS TDC01 V1.17 Serializer Contract Design

**Branch:** `deedly/mvp1/sars-integration/tdc01-foundation`  
**Schema source:** `python_server/resources/sars/SARSTransferDutyReturnV1.17.xsd` with `SARSGMD_BaseTypesV54.2.1.xsd` and `SARSGMD_EnterpriseV54.2.1.xsd` imports.  
**Purpose:** Read-only field-by-field mapping from the bundled V1.17 XSD to DEEDLY canonical data. No serializer code is changed by this document.

## 1. Executive Summary

- The V1.17 root element is `<TransferDutyReturn>` in target namespace `http://www.sars.gov.za/enterpriseMessagingModel/TransferDutyReturn/xml/schemas/version/1.13`.  
- The root content model is `xsd:all`, so element order is not enforced, but cardinality and type constraints are mandatory.  
- Several Phase 2/3 assumptions (separate shareholder structures, broad `TransactionType` free text, internal `sars-transfer-duty-return` root) do not match the actual XSD.  
- The biggest blockers are: `TransactionType`, `TransferDutyType` / `NatureOfPerson` taxonomies, company tax/VAT/registration disambiguation, `PassportCountry` code mapping, property-indicator single-character values, and the VAT block.

## 2. Root Namespace and Structure (verified from XSD)

```xml
<TransferDutyReturn xmlns="http://www.sars.gov.za/enterpriseMessagingModel/TransferDutyReturn/xml/schemas/version/1.13">
  <!-- children may appear in any order because the root uses xsd:all -->
</TransferDutyReturn>
```

Top-level children (from `TransferDutyReturnStructure`): `SourceSoftware`, `TDReferenceNo`, `RelatedExchangeDocumentNo`, `FinancialAccount`, `TotalFairValueAmt`, `AnyOtherConsiderationAmt`, `TransactionType`, `SellersDetails`, `PurchasersDetails`, `ConveyancerDetails`, `EstateAgenciesDetails`, `PropertyDetails`, `DutyInterestPayable`, `VATPayable`, `TransactionStatus`, `PropertyDescs`, `VDPApplication`, `SellersDeclarations`, `PurchasersDeclarations`, `ConveyancerDeclaration`, `AssessmentType`, `ReceiptDetails`, `AdditionalConveyancerDeclaration`, `RevisionNo`, `FormInfo`, `SecurityInfo`, `Metadata`, `FormWizard`.

## 3. Proposed Serializer Object Model

A strongly-typed Python model is recommended so the serializer does not rely on the current generic `ownership-groups` dictionary. The model is built from `build_payload` output plus explicit Golden Record fetches.

```python
class SarsTdc01Document:
    source_software: SourceSoftware | None
    td_reference_no: str
    related_exchange_document_no: str | None
    financial_account: str | None
    total_fair_value_amt: Decimal | None
    any_other_consideration_amt: Decimal | None
    transaction_type: str
    sellers: list[PropertyRepresentative]
    purchasers: list[PropertyRepresentative]
    conveyancer: Conveyancer | None
    estate_agencies: list[EstateAgency]
    property: Property | None
    duty_interest_payable: DutyInterestPayable | None
    vat_payable: VatPayable | None
    transaction_status: TransactionStatus | None
    property_descs: list[str]
    vdp_application: VdpApplication | None
    sellers_declarations: list[Declaration]
    purchasers_declarations: list[Declaration]
    conveyancer_declaration: Declaration | None
    additional_conveyancer_declaration: Declaration | None
    form_wizard: FormWizard | None
    # response-only / system fields are not populated for outbound
```

Supporting models: `PropertyRepresentative`, `Spouse`, `Conveyancer`, `EstateAgency`, `Property`, `DutyInterestPayable`, `DutyInterestItem`, `VatPayable`, `TransactionStatus`, `VdpApplication`, `Declaration`, `FormWizard`, `SourceSoftware`.

## 4. Field-by-Field Serialization Mapping

### Source Software

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/SourceSoftware | SourceSoftwareStructure | 0..1 | Container; see children below. | — | — | — | — | — |
| /TransferDutyReturn/SourceSoftware/Name | string (maxLength: 50) | 1..1 | Recommended for every outbound submission. | config / environment | DEEDLY_SARS_SOURCE_NAME or account_firm_settings.sars_contact_details.source_name | Trim to 50 chars. | If SourceSoftware element is omitted, this is not required. | Final SARS source-software registration value. |
| /TransferDutyReturn/SourceSoftware/Version | string (maxLength: 10) | 1..1 | Required when SourceSoftware is present. | config / environment | DEEDLY_SARS_SOURCE_VERSION or app version | Trim to 10 chars. | If SourceSoftware element is omitted. |  |

### TDReferenceNo

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/TDReferenceNo | TaxRefNoType (pattern: \w{8}\|\w{10}) | 1..1 | Mandatory; system-populated/locked (`Cross_InitialLocked`, `Mask_Modulus_TD`). Spec format: `TD` + `E` + `0` + 6 hex chars. | sars_submissions | sars_submissions.sars_reference_no | Emit exactly as issued by SARS; validate mask `TDE0` + 6 hex before XML validation. | Cannot omit; readiness blocker if missing. | Which operation issues the initial reference (a request-new-return call vs returned by `SubmitTransferDuty` as `TDReferenceNum`); whether required on corrections only. |

### Related Exchange Transaction (EXCH01 — second-submission only)

The functional spec (§4.4) scopes all three of the following fields to the **related exchange transaction**: they display only when the wizard *Exchange* selection is made and this is the second, related submission. `TotalFairValueAmt`/`AnyOtherConsiderationAmt` are governed by `Cond_Amount` (at least one must be completed) and `CrossCheck_TotalValue_TotalConsideration` (Total Fair Value must be ≥ Total Consideration).

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/RelatedExchangeDocumentNo | TaxRefNoType (pattern: \w{8}\|\w{10}) | 0..1 | Conditional — mandatory when Exchange selected (second related submission); same `TDE0`+hex mask. | sars_submissions | sars_submissions.related_exchange_sars_reference_no | Validate mask; emit exactly as issued. | Omit unless Exchange branch applies. | — |
| /TransferDutyReturn/TotalFairValueAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Conditional — Exchange only; Total Fair Value or Any Other Consideration must be completed; TFV ≥ Total Consideration. | sars_submissions | sars_submissions.related_exchange_total_fair_value | Decimal 17,2. | Omit unless Exchange branch applies. | — |
| /TransferDutyReturn/AnyOtherConsiderationAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Conditional — Exchange only; at least one of TFV / Other Consideration required. | sars_submissions | sars_submissions.related_exchange_other_consideration | Decimal 17,2. | Omit unless Exchange branch applies. | — |

### Financial Account

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/FinancialAccount | AccountNoType (pattern: \d{0,10}) | 0..1 | Not present in the TD01 form mapping; envelope/system field. | account_firm_settings | No documented source; do not emit. | Digits only, max 10. | Omit for outbound submission. | Whether the ISV envelope/endpoint requires this element at all (SARS). |

### TransactionType

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/TransactionType | DescriptionTextType (maxLength: 100) | 1..1 | Mandatory; **read-only, pre-populated from the wizard selection** (`Pre_Pop_Wizard`, `Cross_InitialLocked`), e.g. "Bare Dominium Acquired". | transfers / FormWizard model | Derived from the `FormWizard` transaction-type selection; not a free-text matter field. | Emit the SARS label that corresponds to the selected wizard combination. | Cannot omit; readiness blocker. | The exact SARS label vocabulary produced by each wizard selection (SARS). |

### Sellers / Transferors

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/SellersDetails | SellersDetails wrapper (anonymous sequence) | 0..1 | Optional container; required if sellers exist. | transfer_parties | transfer_parties where role in (seller, transferor) | One SellerDetails element per seller. | Omit only if the transfer has no sellers (readiness blocker). | — |
| /TransferDutyReturn/SellersDetails/SellerDetails | PropertyRepresentativeStructure | 1..30 | One per seller/transferor. | Golden Record / transfer_parties | transfer_parties row + get_entity(golden_record_id) | Populate PropertyRepresentativeStructure from Golden Record and sars_party_details. | Omit if a party has no linked Golden Record. |  |
| /TransferDutyReturn/SellersDetails/SellerDetails/NatureOfPerson | EntityTypeType (enum: INDIVIDUAL, SOLE_PROPRIETOR, FOREIGN_RESIDENT, PUBLIC_CO, PRIVATE_CO, CO_WITHOUT_MOTIVES_FOR_GAIN_SEC21, CO_LIMITED_BY_GUARANTEE, FOREIGN_EXTERNAL_CO, EXTERNAL_CO_SEC21A, CO_REG_TRANSVAAL_LAW, PROFESSIONAL_CO, UNLIMITED_CO, CLOSE_CORPORATION, PRIMARY_COOPERATIVE, SECONDARY_COOPERATIVE, TERTIARY_COOPERATIVE, INTERVIVOS_TRUST, MORTIS_CAUSA_TRUST, SPECIAL_A_TRUST, SPECIAL_B_TRUST, EXEMPT_TRUST, PARTNERSHIP, GOVERNMENT_ENTITY, ASSOC_NOT_FOR_GAIN, WELFARE_ORG, CLUB, SECTIONAL_TITLE_ENTITY, FOREIGN_GOV_ORG, RETIREMENT_FUND) | 1..1 | Required for every seller/buyer. | Golden Record / transfer_parties | transfer_parties.entity_type + Golden Record entity kind; exact SARS NatureOfPerson value | Map DEEDLY entity_type + GR subtype/residency to bt:EntityTypeType enumeration. | Never omit if the parent structure is emitted. | Spec §4.6.1 confirms a dropdown of legal entity types (Individual, Public/Private Co, Trust variants, Partnership, Government, etc.) which drives conditional identity/tax rules; the DEEDLY person/company/trust → EntityTypeType mapping table still needs sign-off (Clive). |
| /TransferDutyReturn/SellersDetails/SellerDetails/DeedsNo | DeedsNoType (maxLength: 30; minLength: 0) | 0..1 | Confirmed meaning: **Title Deed No.** of the property being transferred. Functional spec: mandatory, mask = min 7 chars, must contain specials (e.g. `-`, `/`), first char alpha excluding D/J/O/R/Y/Z, `/` followed by valid CCYY, no spaces (`DeedsNo_Validation`). | properties | properties.title_deed_number | Validate functional mask (stricter than XSD). | Spec body places the field in the purchaser container; XSD exposes it on both structures. | Spec contradiction: 2021 change log says Title Deed belongs under the **seller** container; the current spec body (§4.7.1) places it under **purchaser**. Placement to confirm with SARS. |
| /TransferDutyReturn/SellersDetails/SellerDetails/Fullname | FullNamesType (maxLength: 90) | 0..1 | Required for non-natural parties; optional for individuals. | Golden Record | Golden Record company/trust full name or person first_names concatenated | Concatenate/trim to 90 chars. | Omit for individuals if Surname/Initials are supplied. |  |
| /TransferDutyReturn/SellersDetails/SellerDetails/Surname | SurnameType (maxLength: 53) | 0..1 | Required for individuals; optional for companies/trusts. | Golden Record | Golden Record last_name | Trim to 53 chars. | Omit for non-natural where Fullname is used. |  |
| /TransferDutyReturn/SellersDetails/SellerDetails/Initials | InitialsType (maxLength: 5) | 0..1 | Optional. | Golden Record | Golden Record initials | Trim to 5 chars. | Omit if not supplied. |  |
| /TransferDutyReturn/SellersDetails/SellerDetails/IDNo | IDNoType (pattern: \d{13}) | 0..1 | Conditional — mandatory for natural persons per NatureOfPerson rules; SA ID with modulus check per spec. | Golden Record | Golden Record id_number | Validate 13 digits + spec modulus algorithm. | Omit only when passport is used or NatureOfPerson makes it non-mandatory. |  |
| /TransferDutyReturn/SellersDetails/SellerDetails/BirthDate | date | 0..1 | Optional. | Golden Record | Golden Record birth_date | ISO-8601 date (YYYY-MM-DD). | Omit if unavailable. |  |
| /TransferDutyReturn/SellersDetails/SellerDetails/PassportCountryCode | CountryType (pattern: \w{0,3}) | 0..1 | Required with PassportNo (conditional on NatureOfPerson/foreign identity). | Golden Record | Golden Record passport_country | Map to the 3-char code set in spec Appendix E (Country codes). | Omit if RSA ID used. | Confirm GR stores the same Appendix E code values (Clive/Entities). |
| /TransferDutyReturn/SellersDetails/SellerDetails/CellNo | CellNoType (pattern: \d{0,15}) | 0..1 | Optional. | Golden Record | Golden Record mobile / cell phone | Digits only, max 15. | Omit if unavailable. |  |
| /TransferDutyReturn/SellersDetails/SellerDetails/PassportNo | PassportNoType (pattern: \w{0,16}) | 0..1 | Required for foreign individuals. | Golden Record | Golden Record passport_number | Trim to max 16 word chars. | Omit if RSA ID used. |  |
| /TransferDutyReturn/SellersDetails/SellerDetails/IncomeTaxRefNo | TaxRefNoType (pattern: \w{8}\|\w{10}) | 0..1 | Confirmed label: 'Income Tax No.' — conditional mandatory per NatureOfPerson; omitted only when not registered (then AnnualIncomeAmt + NotRegisteredReason become mandatory). | Golden Record | Golden Record income-tax reference field | Validate 8 or 10 word chars + spec modulus check. | Omit if NotRegForIncomeTaxInd = Y. | Confirm authoritative GR field for income-tax ref vs VAT ref vs registration no (Clive/Entities). |
| /TransferDutyReturn/SellersDetails/SellerDetails/NotRegForIncomeTaxInd | YesNoIndType (enum: Y, N) | 0..1 | Conditional — 'Not registered for Income Tax' question; when answered, reason + annual income become mandatory. | sars_party_details | sars_party_details.not_registered_for_income_tax | bool → Y/N. | Omit if the question is not applicable to the NatureOfPerson. |  |
| /TransferDutyReturn/SellersDetails/SellerDetails/NotRegisteredReason | NotRegisteredReasonType (enum: MINOR, UNEMPLOYED, EARNING_UNDER_THE_INCOME_TAX_THRESHOLD, DIVORCE_ORDER,  FOREIGN_INDIVIDUAL) | 0..1 | Conditional — 'Reason not registered' mandatory when not registered for income tax. | sars_party_details | sars_party_details.not_registered_reason | Map to NotRegisteredReasonType enum (MINOR, UNEMPLOYED, EARNING_UNDER_THE_INCOME_TAX_THRESHOLD, DIVORCE_ORDER, ' FOREIGN_INDIVIDUAL' — note the leading space on the last enum in the bundled XSD). | Omit if registered. | Reason value set confirmed by XSD; DEEDLY capture must constrain to these values. |
| /TransferDutyReturn/SellersDetails/SellerDetails/AnnualIncomeAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Conditional — 'annual income from all sources' mandatory when not registered for income tax. | sars_party_details | sars_party_details.annual_income | Decimal, totalDigits 17 fractionDigits 2. | Omit when income-tax registered. |  |
| /TransferDutyReturn/SellersDetails/SellerDetails/CountryOfResidence | string (maxLength: 36) | 0..1 | Conditional — 'If non-resident, state country of residence'. | Golden Record | Golden Record country_of_residence | Trim to 36 chars. | Omit for SA residents. |  |
| /TransferDutyReturn/SellersDetails/SellerDetails/VATRefNo | TaxRefNoType (pattern: \w{8}\|\w{10}) | 0..1 | Conditional — 'VAT No. If applicable'; becomes **mandatory** when VATRateInd = Z (zero rate, `Cross_Mandatory_ZeroRate`). | Golden Record | Golden Record vat_number | Validate 8 or 10 word chars. | Omit if not VAT registered and not zero-rated. | Confirm authoritative GR field distinguishing VAT no from income-tax ref and registration no (Clive/Entities). |
| /TransferDutyReturn/SellersDetails/SellerDetails/RegistrationNo | OrganisationRegNoType (maxLength: 15) | 0..1 | Conditional — 'Company / CC / Trust Reg No.' for non-natural parties. | Golden Record | Golden Record registration_number | Trim to 15 chars. | Omit for natural persons. | Confirm authoritative GR registration-number field (Clive/Entities). |
| /TransferDutyReturn/SellersDetails/SellerDetails/NaturalPersonInd | YesNoIndType (enum: Y, N) | 0..1 | Optional. | transfer_parties | transfer_parties.entity_type | Y if entity_type == 'person' else N | Omit if unreliable. |  |
| /TransferDutyReturn/SellersDetails/SellerDetails/FixedPeriodYears | decimal (minInclusive: 0; maxInclusive: 999) | 0..1 | Optional — 'Fixed Periods (years)'; spec requires numeric, value > 0 when present. | sars_party_details | sars_party_details.fixed_period_years | Integer 0..999 (spec: > 0). | Omit if not applicable. |  |
| /TransferDutyReturn/SellersDetails/SellerDetails/ConnectedPersonInd | YesNoIndType (enum: Y, N) | 0..1 | Optional — seller asks 'Connected Person to the Purchaser', purchaser asks 'Connected Person to the Seller' (direction differs per container). | sars_party_details | sars_party_details.is_connected_person | bool → Y/N. | Omit if not captured. |  |
| /TransferDutyReturn/SellersDetails/SellerDetails/SharePercentage | PercentageType (totalDigits: 5; fractionDigits: 2) | 0..1 | Optional. | sars_party_details | sars_party_details.share_percentage | Decimal totalDigits 5 fractionDigits 2. | Omit if not captured. |  |
| /TransferDutyReturn/SellersDetails/SellerDetails/Gender | GenderType (enum: M, F) | 0..1 | Conditional on NatureOfPerson (natural persons). | Golden Record | Golden Record gender | Map to M/F enum ('F' female, 'M' male). | Omit for non-natural or if unavailable. | Confirm GR gender value set (Clive/Entities). |
| /TransferDutyReturn/SellersDetails/SellerDetails/MaritalStatus | MaritalStatusType (enum: N, I, O, D) | 0..1 | Conditional — radio list (N not married, I in community, O out of community, D divorced); spouse fields follow when married. | Golden Record / sars_party_details | Golden Record marital_status or sars_party_details.spouse_details | Map to N/I/O/D enum. | Omit if unavailable. | Confirm GR marital-status value set (Clive/Entities). |
| /TransferDutyReturn/SellersDetails/SellerDetails/MaritalNotes | string (maxLength: 33) | 0..1 | Optional. | sars_party_details | sars_party_details.marital_notes | Trim to 33 chars. | Omit if not captured. |  |
| /TransferDutyReturn/SellersDetails/SellerDetails/SpouseInitials | InitialsType (maxLength: 5) | 0..1 | Optional. | sars_party_details | sars_party_details.spouse_details.initials | Trim to 5 chars. | Omit if no spouse data. | JSON shape of sars_party_details.spouse_details. |
| /TransferDutyReturn/SellersDetails/SellerDetails/SpouseIDNo | IDNoType (pattern: \d{13}) | 0..1 | Optional. | sars_party_details | sars_party_details.spouse_details.id_number | Validate 13 digits. | Omit if no spouse data. |  |
| /TransferDutyReturn/SellersDetails/SellerDetails/SpousePassportNo | PassportNoType (pattern: \w{0,16}) | 0..1 | Optional. | sars_party_details | sars_party_details.spouse_details.passport_number | Trim to 16 word chars. | Omit if no spouse data. |  |
| /TransferDutyReturn/SellersDetails/SellerDetails/SpousePassportCountryCode | CountryType (pattern: \w{0,3}) | 0..1 | Optional. | sars_party_details | sars_party_details.spouse_details.passport_country | Map to SARS CountryType code. | Omit if no spouse data. | Spouse passport country source/mapping. |
| /TransferDutyReturn/SellersDetails/SellerDetails/AcquisitionDate | date | 0..1 | Optional — 'Date property acquired by seller' (seller context). | sars_party_details | sars_party_details.acquisition_date | ISO-8601 date. | Omit if not captured. |  |
| /TransferDutyReturn/SellersDetails/SellerDetails/PurchasePriceAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Optional; original purchase price for the seller. | sars_party_details | sars_party_details.original_purchase_price | Decimal 17,2. | Omit if not captured. |  |
| /TransferDutyReturn/SellersDetails/SellerDetails/EffectiveDate | date | 0..1 | Optional — 'Effective Date of Transaction (Date of Last Signatory)'; `Future_Date_Validate` — must reflect the date the seller signed the deed of sale. | sars_party_details | sars_party_details.effective_date_of_transaction | ISO-8601 date. | Omit if not captured. |  |

### Purchasers / Transferees

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/PurchasersDetails | PurchasersDetails wrapper (anonymous sequence) | 0..1 | Optional container; required if purchasers exist. | transfer_parties | transfer_parties where role in (buyer, transferee) | One PurchaserDetails element per purchaser. | Omit only if the transfer has no purchasers (readiness blocker). | — |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails | PropertyRepresentativeStructure | 1..30 | One per purchaser/transferee. | Golden Record / transfer_parties | transfer_parties row + get_entity(golden_record_id) | Populate PropertyRepresentativeStructure from Golden Record and sars_party_details. | Omit if a party has no linked Golden Record. |  |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/NatureOfPerson | EntityTypeType (enum: INDIVIDUAL, SOLE_PROPRIETOR, FOREIGN_RESIDENT, PUBLIC_CO, PRIVATE_CO, CO_WITHOUT_MOTIVES_FOR_GAIN_SEC21, CO_LIMITED_BY_GUARANTEE, FOREIGN_EXTERNAL_CO, EXTERNAL_CO_SEC21A, CO_REG_TRANSVAAL_LAW, PROFESSIONAL_CO, UNLIMITED_CO, CLOSE_CORPORATION, PRIMARY_COOPERATIVE, SECONDARY_COOPERATIVE, TERTIARY_COOPERATIVE, INTERVIVOS_TRUST, MORTIS_CAUSA_TRUST, SPECIAL_A_TRUST, SPECIAL_B_TRUST, EXEMPT_TRUST, PARTNERSHIP, GOVERNMENT_ENTITY, ASSOC_NOT_FOR_GAIN, WELFARE_ORG, CLUB, SECTIONAL_TITLE_ENTITY, FOREIGN_GOV_ORG, RETIREMENT_FUND) | 1..1 | Required for every seller/buyer. | Golden Record / transfer_parties | transfer_parties.entity_type + Golden Record entity kind; exact SARS NatureOfPerson value | Map DEEDLY entity_type + GR subtype/residency to bt:EntityTypeType enumeration. | Never omit if the parent structure is emitted. | Spec §4.6.1 confirms a dropdown of legal entity types (Individual, Public/Private Co, Trust variants, Partnership, Government, etc.) which drives conditional identity/tax rules; the DEEDLY person/company/trust → EntityTypeType mapping table still needs sign-off (Clive). |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/DeedsNo | DeedsNoType (maxLength: 30; minLength: 0) | 0..1 | Confirmed meaning: **Title Deed No.** of the property being transferred. Functional spec (§4.7.1): **Mandatory: Yes**, mask = min 7 chars, must contain specials (e.g. `-`, `/`), first char alpha excluding D/J/O/R/Y/Z, `/` followed by valid CCYY, no spaces (`DeedsNo_Validation`). | properties | properties.title_deed_number | Validate functional mask (stricter than XSD). | Functionally mandatory per spec even though XSD marks it optional. | Spec contradiction: 2021 change log says Title Deed belongs under the **seller** container; the current spec body (§4.7.1) places it under **purchaser**. Placement to confirm with SARS. |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/Fullname | FullNamesType (maxLength: 90) | 0..1 | Required for non-natural parties; optional for individuals. | Golden Record | Golden Record company/trust full name or person first_names concatenated | Concatenate/trim to 90 chars. | Omit for individuals if Surname/Initials are supplied. |  |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/Surname | SurnameType (maxLength: 53) | 0..1 | Required for individuals; optional for companies/trusts. | Golden Record | Golden Record last_name | Trim to 53 chars. | Omit for non-natural where Fullname is used. |  |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/Initials | InitialsType (maxLength: 5) | 0..1 | Optional. | Golden Record | Golden Record initials | Trim to 5 chars. | Omit if not supplied. |  |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/IDNo | IDNoType (pattern: \d{13}) | 0..1 | Conditional — mandatory for natural persons per NatureOfPerson rules; SA ID with modulus check per spec. | Golden Record | Golden Record id_number | Validate 13 digits + spec modulus algorithm. | Omit only when passport is used or NatureOfPerson makes it non-mandatory. |  |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/BirthDate | date | 0..1 | Optional. | Golden Record | Golden Record birth_date | ISO-8601 date (YYYY-MM-DD). | Omit if unavailable. |  |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/PassportCountryCode | CountryType (pattern: \w{0,3}) | 0..1 | Required with PassportNo (conditional on NatureOfPerson/foreign identity). | Golden Record | Golden Record passport_country | Map to the 3-char code set in spec Appendix E (Country codes). | Omit if RSA ID used. | Confirm GR stores the same Appendix E code values (Clive/Entities). |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/CellNo | CellNoType (pattern: \d{0,15}) | 0..1 | Optional. | Golden Record | Golden Record mobile / cell phone | Digits only, max 15. | Omit if unavailable. |  |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/PassportNo | PassportNoType (pattern: \w{0,16}) | 0..1 | Required for foreign individuals. | Golden Record | Golden Record passport_number | Trim to max 16 word chars. | Omit if RSA ID used. |  |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/IncomeTaxRefNo | TaxRefNoType (pattern: \w{8}\|\w{10}) | 0..1 | Confirmed label: 'Income Tax No.' — conditional mandatory per NatureOfPerson; omitted only when not registered (then AnnualIncomeAmt + NotRegisteredReason become mandatory). | Golden Record | Golden Record income-tax reference field | Validate 8 or 10 word chars + spec modulus check. | Omit if NotRegForIncomeTaxInd = Y. | Confirm authoritative GR field for income-tax ref vs VAT ref vs registration no (Clive/Entities). |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/NotRegForIncomeTaxInd | YesNoIndType (enum: Y, N) | 0..1 | Conditional — 'Not registered for Income Tax' question; when answered, reason + annual income become mandatory. | sars_party_details | sars_party_details.not_registered_for_income_tax | bool → Y/N. | Omit if the question is not applicable to the NatureOfPerson. |  |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/NotRegisteredReason | NotRegisteredReasonType (enum: MINOR, UNEMPLOYED, EARNING_UNDER_THE_INCOME_TAX_THRESHOLD, DIVORCE_ORDER,  FOREIGN_INDIVIDUAL) | 0..1 | Conditional — 'Reason not registered' mandatory when not registered for income tax. | sars_party_details | sars_party_details.not_registered_reason | Map to NotRegisteredReasonType enum (MINOR, UNEMPLOYED, EARNING_UNDER_THE_INCOME_TAX_THRESHOLD, DIVORCE_ORDER, ' FOREIGN_INDIVIDUAL' — note the leading space on the last enum in the bundled XSD). | Omit if registered. | Reason value set confirmed by XSD; DEEDLY capture must constrain to these values. |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/AnnualIncomeAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Conditional — 'annual income from all sources' mandatory when not registered for income tax. | sars_party_details | sars_party_details.annual_income | Decimal, totalDigits 17 fractionDigits 2. | Omit when income-tax registered. |  |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/CountryOfResidence | string (maxLength: 36) | 0..1 | Conditional — 'If non-resident, state country of residence'. | Golden Record | Golden Record country_of_residence | Trim to 36 chars. | Omit for SA residents. |  |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/VATRefNo | TaxRefNoType (pattern: \w{8}\|\w{10}) | 0..1 | Conditional — 'VAT No. If applicable'; becomes **mandatory** when VATRateInd = Z (zero rate, `Cross_Mandatory_ZeroRate`). | Golden Record | Golden Record vat_number | Validate 8 or 10 word chars. | Omit if not VAT registered and not zero-rated. | Confirm authoritative GR field distinguishing VAT no from income-tax ref and registration no (Clive/Entities). |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/RegistrationNo | OrganisationRegNoType (maxLength: 15) | 0..1 | Conditional — 'Company / CC / Trust Reg No.' for non-natural parties. | Golden Record | Golden Record registration_number | Trim to 15 chars. | Omit for natural persons. | Confirm authoritative GR registration-number field (Clive/Entities). |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/NaturalPersonInd | YesNoIndType (enum: Y, N) | 0..1 | Optional. | transfer_parties | transfer_parties.entity_type | Y if entity_type == 'person' else N | Omit if unreliable. |  |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/FixedPeriodYears | decimal (minInclusive: 0; maxInclusive: 999) | 0..1 | Optional — 'Fixed Periods (years)'; spec requires numeric, value > 0 when present. | sars_party_details | sars_party_details.fixed_period_years | Integer 0..999 (spec: > 0). | Omit if not applicable. |  |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/ConnectedPersonInd | YesNoIndType (enum: Y, N) | 0..1 | Optional — seller asks 'Connected Person to the Purchaser', purchaser asks 'Connected Person to the Seller' (direction differs per container). | sars_party_details | sars_party_details.is_connected_person | bool → Y/N. | Omit if not captured. |  |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/SharePercentage | PercentageType (totalDigits: 5; fractionDigits: 2) | 0..1 | Optional. | sars_party_details | sars_party_details.share_percentage | Decimal totalDigits 5 fractionDigits 2. | Omit if not captured. |  |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/Gender | GenderType (enum: M, F) | 0..1 | Conditional on NatureOfPerson (natural persons). | Golden Record | Golden Record gender | Map to M/F enum ('F' female, 'M' male). | Omit for non-natural or if unavailable. | Confirm GR gender value set (Clive/Entities). |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/MaritalStatus | MaritalStatusType (enum: N, I, O, D) | 0..1 | Conditional — radio list (N not married, I in community, O out of community, D divorced); spouse fields follow when married. | Golden Record / sars_party_details | Golden Record marital_status or sars_party_details.spouse_details | Map to N/I/O/D enum. | Omit if unavailable. | Confirm GR marital-status value set (Clive/Entities). |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/MaritalNotes | string (maxLength: 33) | 0..1 | Optional. | sars_party_details | sars_party_details.marital_notes | Trim to 33 chars. | Omit if not captured. |  |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/SpouseInitials | InitialsType (maxLength: 5) | 0..1 | Optional. | sars_party_details | sars_party_details.spouse_details.initials | Trim to 5 chars. | Omit if no spouse data. | JSON shape of sars_party_details.spouse_details. |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/SpouseIDNo | IDNoType (pattern: \d{13}) | 0..1 | Optional. | sars_party_details | sars_party_details.spouse_details.id_number | Validate 13 digits. | Omit if no spouse data. |  |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/SpousePassportNo | PassportNoType (pattern: \w{0,16}) | 0..1 | Optional. | sars_party_details | sars_party_details.spouse_details.passport_number | Trim to 16 word chars. | Omit if no spouse data. |  |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/SpousePassportCountryCode | CountryType (pattern: \w{0,3}) | 0..1 | Optional. | sars_party_details | sars_party_details.spouse_details.passport_country | Map to SARS CountryType code. | Omit if no spouse data. | Spouse passport country source/mapping. |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/AcquisitionDate | date | 0..1 | Optional — 'Date property acquired by seller' (seller context). | sars_party_details | sars_party_details.acquisition_date | ISO-8601 date. | Omit if not captured. |  |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/PurchasePriceAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Optional; original purchase price for the seller. | sars_party_details | sars_party_details.original_purchase_price | Decimal 17,2. | Omit if not captured. |  |
| /TransferDutyReturn/PurchasersDetails/PurchaserDetails/EffectiveDate | date | 0..1 | Optional — 'Effective Date of Transaction (Date of Last Signatory)'; `Future_Date_Validate` — must reflect the date the seller signed the deed of sale. | sars_party_details | sars_party_details.effective_date_of_transaction | ISO-8601 date. | Omit if not captured. |  |

### Existing Shareholders / Members / Beneficiaries

The V1.17 XSD documentation (2025-09-02) explicitly **removed** the `ExistingShareholdersDetails` and `NewShareholdersDetails` structures that existed in earlier transfer-duty return versions. Only the counts `NoOfExistingShareholders` and `NoOfNewShareholders` remain inside `FormWizard`. Therefore there are currently **no outbound XML elements** for individual existing/new shareholders in V1.17.

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/FormWizard/NoOfExistingShareholders | decimal (minInclusive: 0; maxInclusive: 30) | 0..1 | Optional; only meaningful for `TransferDutyType = SHARES_MEMBERS_TRANSFER`. | transfer_parties | count of transfer_parties where role = existing_shareholder | Integer 0..30 | Omit if zero or not applicable. | Semantics now that V1.17 removed the actual shareholder structures. |

### New Shareholders / Members / Beneficiaries

Same removal note as above. The only V1.17 artifact is `FormWizard/NoOfNewShareholders`.

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/FormWizard/NoOfNewShareholders | decimal (minInclusive: 0; maxInclusive: 30) | 0..1 | Optional; only meaningful for `TransferDutyType = SHARES_MEMBERS_TRANSFER`. | transfer_parties | count of transfer_parties where role = new_shareholder | Integer 0..30 | Omit if zero or not applicable. | Semantics now that V1.17 removed the actual shareholder structures. |

### Conveyancer

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/ConveyancerDetails | ConveyancerDetailsStructure | 0..1 | Optional container. | account_firm_settings | accountable institution firm profile | Populate ConveyancerDetailsStructure. | Omit if no conveyancer details captured. | — |
| /TransferDutyReturn/ConveyancerDetails/ID | string (maxLength: 10) | 0..1 | No corresponding field exists in the TD01 form (spec §4.8 lists only firm, name, tel, email). | account_firm_settings | account_firm_settings.sars_contact_details.conveyancer_id | Trim to 10 chars. | Omit if not available. | Whether the element is required by the ISV envelope (SARS). |
| /TransferDutyReturn/ConveyancerDetails/Firm | OrganisationNameType (maxLength: 120) | 1..1 | Required when ConveyancerDetails emitted. | account_firm_settings | account_firm_settings.firm_name | Trim to 120 chars. | Omit whole ConveyancerDetails if missing. |  |
| /TransferDutyReturn/ConveyancerDetails/Name | OrganisationNameType (maxLength: 120) | 1..1 | Required when ConveyancerDetails emitted. | account_firm_settings | account_firm_settings.sars_contact_details.contact_name | Trim to 120 chars. | Omit whole ConveyancerDetails if missing. | Which firm contact name SARS expects (firm vs individual). |
| /TransferDutyReturn/ConveyancerDetails/TelNo | TelFaxNoType (pattern: \d{0,15}) | 0..1 | Optional. | account_firm_settings | account_firm_settings.sars_contact_details.tel_no or fax | Digits only, max 15. | Omit if not captured. |  |
| /TransferDutyReturn/ConveyancerDetails/Email | EmailType (pattern: .{0,53}) | 0..1 | Optional. | account_firm_settings | account_firm_settings.sars_contact_details.email | Max 53 chars; validate email format loosely. | Omit if not captured. |  |

### Estate Agencies

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/EstateAgenciesDetails | EstateAgenciesDetails wrapper (anonymous sequence) | 0..1 | Optional container. | transfer_parties | transfer_parties where role = estate_agent | One EstateAgencyDetails per estate agent. | Omit if no estate agents. | — |
| /TransferDutyReturn/EstateAgenciesDetails/EstateAgencyDetails | EstateAgencyDetailsStructure | 1..10 | One per estate-agent party. | Golden Record / transfer_parties | GR identity for the estate agent | Populate EstateAgencyDetailsStructure. | Omit if party has no linked Golden Record. |  |
| /TransferDutyReturn/EstateAgenciesDetails/EstateAgencyDetails/CommissionPayable | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Optional — 'Commission Payable on this Transaction (incl VAT)'. | matter_capture | Not currently stored; needs a structured capture field. | Decimal 17,2. | Omit if no estate agency. | Capture location for commission (Louis/Product). |
| /TransferDutyReturn/EstateAgenciesDetails/EstateAgencyDetails/TelNo | TelFaxNoType (pattern: \d{0,15}) | 0..1 | Optional — 'Business Telephone Number'. | matter_capture / Golden Record | Estate agency business phone. | Digits, max 15. | Omit if not captured. |  |
| /TransferDutyReturn/EstateAgenciesDetails/EstateAgencyDetails/Surname | SurnameType (maxLength: 53) | 0..1 | Optional — agent 'Surname'. | matter_capture / Golden Record | Estate agent surname. | Trim to 53. | Omit if not captured. | Whether estate agents are GR parties or matter contacts (Clive/Entities). |
| /TransferDutyReturn/EstateAgenciesDetails/EstateAgencyDetails/CellNo | CellNoType (pattern: \d{0,15}) | 0..1 | Optional. | Golden Record | GR mobile | Digits, max 15. | Omit if not captured. |  |
| /TransferDutyReturn/EstateAgenciesDetails/EstateAgencyDetails/Initials | InitialsType (maxLength: 5) | 0..1 | Optional — agent 'Initials'. | matter_capture / Golden Record | Estate agent initials. | Trim to 5. | Omit if not captured. | Whether estate agents are GR parties or matter contacts (Clive/Entities). |
| /TransferDutyReturn/EstateAgenciesDetails/EstateAgencyDetails/IncomeTaxNo | TaxRefNoType (pattern: \w{8}\|\w{10}) | 0..1 | Optional — agent 'Income Tax No.'. | matter_capture / Golden Record | Estate agent income-tax number. | 8/10 word chars. | Omit if not captured. | Whether estate agents are GR parties or matter contacts (Clive/Entities). |

### Property

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/PropertyDetails | PropertyDetailsStructure | 0..1 | Optional container, but SellingPriceAmt is required if present. | properties / sars_property_details / sars_calculations | transfer property and SARS property capture | Populate PropertyDetailsStructure. | Omit whole block only if property data is unavailable. | Many property-field semantics, see children. |
| /TransferDutyReturn/PropertyDetails/VATPurposeInd | YesNoIndType (enum: Y, N) | 0..1 | Conditional — 'Is the property an enterprise asset for VAT purpose?'; drives InputTaxClaimedInd, VATDeclarationPeriod and GoingConcernPayableAmt. | sars_property_details | sars_property_details.is_enterprise_asset_for_vat | bool → Y/N. | Omit if VAT block not applicable. | — |
| /TransferDutyReturn/PropertyDetails/InputTaxClaimedInd | YesNoIndType (enum: Y, N) | 0..1 | Conditional — 'Was any input tax claimed in respect of property?'; mandatory when VATPurposeInd = Y (`VAT_Quest`). | sars_property_details | sars_property_details.input_tax_claimed | bool → Y/N. | Omit unless VATPurposeInd = Y. | — |
| /TransferDutyReturn/PropertyDetails/TransactionDate | date | 0..1 | Conditional — 'Date of Transaction/Acquisition'; populated by `Pop_Date`/`Wiz_Date_Pop` rules in the form. | transfers | transfers.transaction_date | ISO-8601 date. | Omit if unavailable. |  |
| /TransferDutyReturn/PropertyDetails/PropertyImprovementInd | IndicatorType (maxLength: 1) | 0..1 | Conditional — 'Is the Property?' radio list. Confirmed values per ICC mapping: `I` = Improved, `U` = Unimproved. | sars_property_details | sars_property_details.property_improvement_indicator | Map to single-char code. | Omit if not captured. | — |
| /TransferDutyReturn/PropertyDetails/BoughtByInd | IndicatorType (maxLength: 1) | 0..1 | Conditional — 'Bought by' radio list. Confirmed values per ICC mapping: `T` = Private Treaty, `A` = Public Auction, `O` = Other. | sars_property_details | sars_property_details.bought_by_indicator | Map to single-char code. | Omit if not captured. | — |
| /TransferDutyReturn/PropertyDetails/PropertyUsageInd | IndicatorType (maxLength: 1) | 0..1 | Conditional — 'How was property used?' radio list. Confirmed values per ICC mapping: `P` = primary residence, `L` = let as residence, `B` = business purposes, `O` = Other. | sars_property_details | sars_property_details.property_usage_indicator | Map to single-char code. | Omit if not captured. | — |
| /TransferDutyReturn/PropertyDetails/OtherPropertyUsageDesc | string (maxLength: 14) | 0..1 | Optional; used when PropertyUsageInd = Other. | sars_property_details | sars_property_details.other_property_usage_desc | Trim to 14 chars. | Omit if not applicable. |  |
| /TransferDutyReturn/PropertyDetails/PropertyNatureInd | IndicatorType (maxLength: 1) | 0..1 | Conditional — 'Nature of property' radio list. Confirmed values per ICC mapping: `P` primary residence, `R` other residential, `S` small holding, `C` commercial building, `I` industrial building, `M` mining property rights, `O` other, `F` farming. | sars_property_details | sars_property_details.property_nature_indicator | Map to single-char code. | Omit if not captured. | — |
| /TransferDutyReturn/PropertyDetails/OtherPropertyNatureDesc | string (maxLength: 35) | 0..1 | Optional; used when PropertyNatureInd = Other. | sars_property_details | sars_property_details.other_property_nature_desc | Trim to 35 chars. | Omit if not applicable. |  |
| /TransferDutyReturn/PropertyDetails/IncomeTaxActApplicableInd | YesNoIndType (enum: Y, N) | 0..1 | Conditional — 'Are the provisions of section 35A of the Income Tax Act applicable? (i.e. bought from a non-resident)'. | sars_property_details | sars_property_details.income_tax_act_applicable | Map to Y/N. | Omit if not captured. | — |
| /TransferDutyReturn/PropertyDetails/LocalValuationAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Optional — 'Local Authority Valuation (Urban Properties)'. | — | Not currently captured — needs a structured field if required. | Decimal 17,2. | Omit if not captured. | Whether to add local-authority valuation capture (Louis/Product). |
| /TransferDutyReturn/PropertyDetails/BondAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Optional — 'Amount of Bond'. | — | Not currently captured — needs a structured field if required. | Decimal 17,2. | Omit if not captured. | Whether to add bond-amount capture (Louis/Product). |
| /TransferDutyReturn/PropertyDetails/PropertyValueAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Optional — 'Value of Property' valuation field. | — | Not currently captured — needs a structured field if required. | Decimal 17,2. | Omit if not captured. | Whether to add property-value capture (Louis/Product). |
| /TransferDutyReturn/PropertyDetails/MonthlyRentalAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Optional. | sars_property_details | sars_property_details.monthly_rental_value | Decimal 17,2. | Omit if not captured. |  |
| /TransferDutyReturn/PropertyDetails/LandValueAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Optional. | sars_property_details | sars_property_details.land_value | Decimal 17,2. | Omit if not captured. |  |
| /TransferDutyReturn/PropertyDetails/OccupationalRentAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Optional. | sars_property_details | sars_property_details.occupational_rent | Decimal 17,2. | Omit if not captured. |  |
| /TransferDutyReturn/PropertyDetails/ImprovementValueAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Optional. | sars_property_details | sars_property_details.improvement_value | Decimal 17,2. | Omit if not captured. |  |
| /TransferDutyReturn/PropertyDetails/SellingPriceAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 1..1 | Required within PropertyDetails. | transfers / sars_calculations | transfers.purchase_price or sars_calculations.purchase_price | Decimal 17,2. | Cannot omit if PropertyDetails is emitted; readiness blocker. |  |
| /TransferDutyReturn/PropertyDetails/TotalFairAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Optional — 'Total Fair Value' inside the property valuation sub-container; distinct from the root EXCH01 field and from Total Consideration per spec §4.10.10. | sars_property_details | sars_property_details.total_fair_value | Decimal 17,2. | Omit if not captured. | — |
| /TransferDutyReturn/PropertyDetails/OtherConsiderationAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Optional — 'Any Other Consideration Payable' inside the property valuation sub-container. | sars_property_details | sars_property_details.other_consideration | Decimal 17,2. | Omit if zero/null. | — |
| /TransferDutyReturn/PropertyDetails/TotalConsiderationAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Optional — 'Total Consideration' inside the valuation sub-container; participates in the cross-field rule that related-exchange Total Fair Value must be ≥ Total Consideration. | sars_calculations | sars_calculations.total_consideration | Decimal 17,2. | Omit if not calculated. | — |

### Transfer Duty and Interest

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/DutyInterestPayable | DutyInterestPayableStructure | 0..1 | Optional container. | sars_calculations | latest sars_calculations for transfer | Populate DutyInterestPayableStructure. | Omit if calculation not run. | — |
| /TransferDutyReturn/DutyInterestPayable/PayableAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Optional in XSD; spec marks the duty container calculated/locked (`Cross_InitialLocked`) — calculated output, not free input. | sars_calculations | sars_calculations.transfer_duty_payable | Decimal 17,2. | Omit if not calculated. |  |
| /TransferDutyReturn/DutyInterestPayable/NaturalPersons | NaturalPersons wrapper (anonymous sequence) | 0..1 | Conditional — spec §4.11.2: % / R / = rows are locked/populated (`Cross_InitialLocked`), repeatable up to 8; allocation output, not free input. | sars_calculations | sars_calculations.party_allocations filtered by allocation_type=natural | Wrap one or more NaturalPerson elements. | Omit if no natural-person allocations. | — |
| /TransferDutyReturn/DutyInterestPayable/NaturalPersons/NaturalPerson | DutyInterestPayableItemStructure | 1..8 | One row per natural-person allocation. | sars_calculations | sars_calculations.party_allocations filtered by allocation_type=natural | Populate DutyInterestPayableItemStructure. | Omit if no natural allocations. |  |
| /TransferDutyReturn/DutyInterestPayable/NaturalPersons/NaturalPerson/Percentage | PercentageType (totalDigits: 5; fractionDigits: 2) | 1..1 | Required per natural allocation. | sars_calculations | sars_calculations.party_allocations[].share_percentage where allocation_type=natural | Decimal 5,2. | Omit if no natural allocations. |  |
| /TransferDutyReturn/DutyInterestPayable/NaturalPersons/NaturalPerson/PayableAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 1..1 | Required per natural allocation. | sars_calculations | sars_calculations.party_allocations[].allocation_amount where allocation_type=natural | Decimal 17,2. | Omit if no natural allocations. |  |
| /TransferDutyReturn/DutyInterestPayable/NaturalPersons/NaturalPerson/CalculatedPayableAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 1..1 | Required per natural allocation. | sars_calculations | sars_calculations.party_allocations[].allocation_amount (same as PayableAmt at this stage) | Decimal 17,2. | Omit if no natural allocations. | Whether PayableAmt and CalculatedPayableAmt differ for SARS assessment. |
| /TransferDutyReturn/DutyInterestPayable/NonNaturalPersons | NonNaturalPersons wrapper (anonymous sequence) | 0..1 | Conditional — spec §4.11.3: same locked/populated repeat pattern as natural persons (up to 8 rows). | sars_calculations | sars_calculations.party_allocations filtered by allocation_type=non_natural | Wrap one or more NonNaturalPerson elements. | Omit if no non-natural-person allocations. | — |
| /TransferDutyReturn/DutyInterestPayable/NonNaturalPersons/NonNaturalPerson | DutyInterestPayableItemStructure | 1..8 | One row per non-natural allocation. | sars_calculations | sars_calculations.party_allocations filtered by allocation_type=non_natural | Populate DutyInterestPayableItemStructure. | Omit if no non-natural allocations. |  |
| /TransferDutyReturn/DutyInterestPayable/NonNaturalPersons/NonNaturalPerson/Percentage | PercentageType (totalDigits: 5; fractionDigits: 2) | 1..1 | Required per non-natural allocation. | sars_calculations | sars_calculations.party_allocations[].share_percentage where allocation_type=non_natural | Decimal 5,2. | Omit if no non-natural allocations. |  |
| /TransferDutyReturn/DutyInterestPayable/NonNaturalPersons/NonNaturalPerson/PayableAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 1..1 | Required per non-natural allocation. | sars_calculations | sars_calculations.party_allocations[].allocation_amount where allocation_type=non_natural | Decimal 17,2. | Omit if no non-natural allocations. |  |
| /TransferDutyReturn/DutyInterestPayable/NonNaturalPersons/NonNaturalPerson/CalculatedPayableAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 1..1 | Required per non-natural allocation. | sars_calculations | sars_calculations.party_allocations[].allocation_amount | Decimal 17,2. | Omit if no non-natural allocations. |  |
| /TransferDutyReturn/DutyInterestPayable/SubTotalPayableAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Optional in XSD; spec treats 'Sub total' as a calculated field. | sars_calculations | sars_calculations.sub_total | Decimal 17,2. | Omit if not calculated. |  |
| /TransferDutyReturn/DutyInterestPayable/PenaltyInterestAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Optional — 'Penalty/Interest' calculated field. | sars_calculations | sars_calculations.penalty_interest | Decimal 17,2. | Omit if zero/null. |  |
| /TransferDutyReturn/DutyInterestPayable/TotalPayableAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Optional in XSD; spec treats 'Total Payable' as a calculated field. | sars_calculations | sars_calculations.total_payable | Decimal 17,2. | Omit if not calculated. |  |

### VAT Payable

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/VATPayable | VATPayableStructure | 0..1 | Optional container; only for VAT transactions. | sars_calculations | sars_calculations VAT fields | Populate VATPayableStructure. | Omit when is_vat_transaction is false. | VAT semantics, see children. |
| /TransferDutyReturn/VATPayable/VATRateInd | string (enum: Z, S) | 0..1 | Confirmed: `S` = Standard, `Z` = Zero (spec §4.12.1, ICC mapping). Conditional on the VAT block applying; `Cross_Mandatory_ZeroRate` makes purchaser VATRefNo mandatory when Z. | sars_calculations | sars_calculations.vat_rate_indicator | Must be Z or S. | Omit when not a VAT transaction. | — |
| /TransferDutyReturn/VATPayable/IncludingVATInd | YesNoIndType (enum: Y, N) | 0..1 | Conditional — 'Including VAT' radio (spec §4.12.2). | transfers / sars_calculations | Derived from is_vat_transaction and transaction terms | bool → Y/N. | Omit if not a VAT transaction. | — |
| /TransferDutyReturn/VATPayable/VATPayableAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Conditional — 'VAT Payable' amount within the VAT calculation container (spec §4.12.3). Property-transaction VAT is explicitly separate from attorney-fee VAT. | sars_calculations | sars_calculations.vat_payable | Decimal 17,2. | Omit if not a VAT transaction. | — |
| /TransferDutyReturn/VATPayable/VATDeclarationPeriod | PeriodType (pattern: \d{2}\|\d{6}) | 0..1 | Conditional — 'The estimated tax period that the output tax will be declared on the VAT201 Declaration (CCYYMM)'; mandatory when VATPurposeInd = Y (`Con_Prop_Qust`). Emit as CCYYMM (6 digits). | sars_calculations | sars_calculations.calculation_data.vat_declaration_period (dedicated capture recommended) | Emit CCYYMM; validate `\d{2}|\d{6}`. | Omit unless enterprise-asset = Y. | Which entity's VAT201 period is intended and how DEEDLY should derive it (Louis/Product + SARS). |
| /TransferDutyReturn/VATPayable/OutputTaxPayableAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Mandatory within the VAT container per spec §4.12.5 ('Amount', Mandatory: Yes). | sars_calculations | sars_calculations.output_tax_payable | Decimal 17,2. | Omit only if the VAT block does not apply. | — |
| /TransferDutyReturn/VATPayable/GoingConcernPayableAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 0..1 | Conditional — 'The supply is that of a going concern which is subject to the zero rate'; mandatory when enterprise-asset = Y **and** VATRateInd = Z (`Con_Prop_Qust_0`, `Rate_Zero`). | sars_calculations | sars_calculations.supply_going_concern_payable | Decimal 17,2. | Omit unless enterprise-asset = Y and zero-rated. | — |

### Transaction Status / Exemptions

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/TransactionStatus | TransactionStatusStructure | 0..1 | Optional container. | sars_submissions | sars_submissions exemption fields | Populate TransactionStatusStructure. | Omit if no exemption applies. | — |
| /TransferDutyReturn/TransactionStatus/Section9Exemption | string (maxLength: 53) | 0..1 | Conditional — 'Exempt in terms of section 9 of the Transfer Duty Act'; selected from the SARS list (spec §4.13.1, Appendix A). | sars_submissions | sars_submissions.exemption_section9 | Trim to 53 chars. | Omit if no exemption. | — |
| /TransferDutyReturn/TransactionStatus/AnotherActExemption | string (maxLength: 37) | 0..1 | Conditional — 'Exemptions allowed by another act'; mandatory when Section 9 selection is 'Other' — capture act name, number and applicable section. | sars_submissions | sars_submissions.exemption_other_act | Trim to 37 chars. | Omit unless 'Other' exemption selected. | — |

### Property Descriptions

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/PropertyDescs | PropertyDescs wrapper (anonymous sequence) | 0..1 | Optional container; up to 500 descriptions. | properties | property description lines | One PropertyDesc per line. | Omit if not captured. | — |
| /TransferDutyReturn/PropertyDescs/PropertyDesc | string (maxLength: 530) | 1..500 | One property description line — 'Description of Property' (form field length 212, XSD allows 530). | properties | property description or matter property description | Trim to 530 chars. | Omit if not captured. | — |

### VDP Application

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/VDPApplication | VDPApplicationStructure | 0..1 | Container optional in XSD; when present, `VDPIndicator` is mandatory Y/N. Spec §4.15: if VDPIndicator = Y the application number unlocks and becomes mandatory (`VDP_Check`); format = `VDP` + 6 digits + 1 modulus-9 check digit (`Mask_Modulus9_CheckVDPNo`). | sars_submissions | sars_submissions.vdp_* fields | Populate VDPApplicationStructure. | Omit if not a VDP case. | — |
| /TransferDutyReturn/VDPApplication/VDPIndicator | YesNoIndType (enum: Y, N) | 1..1 | Mandatory Y/N when VDP block present (spec §4.15.1 Mandatory: Yes). | sars_submissions | sars_submissions.vdp_indicator | bool → Y/N. | Omit VDP block when not applicable. | — |
| /TransferDutyReturn/VDPApplication/VDPApplicationNo | VDPApplicationNoType (pattern: \w{0,10}) | 0..1 | Conditional — mandatory when VDPIndicator = Y. Format: `VDP` + 6 digits + 1 modulus-9 check digit (10 chars; `Mask_Modulus9_CheckVDPNo`). | sars_submissions | sars_submissions.vdp_application_no | Validate `VDP\d{6}\d` in addition to XSD `\w{0,10}`. | Omit if not applicable. | — |

### Sellers Declarations

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/SellersDeclarations | SellersDeclarations wrapper (anonymous sequence) | 0..1 | Optional container. | sars_declaration_events | sars_declaration_events where declaration_type=seller | One SellerDeclaration per seller declaration. | Omit if no seller declarations. | — |
| /TransferDutyReturn/SellersDeclarations/SellerDeclaration | SimpleDeclarationStructure | 1..30 | One per seller declaration. | sars_declaration_events | sars_declaration_events row | Populate SimpleDeclarationStructure. | Omit if not declared. |  |
| /TransferDutyReturn/SellersDeclarations/SellerDeclaration/Signature | string | 0..1 | Optional in XSD; spec §4.16–4.18 requires declaration + signature box + date per signer. Signature is a plain string element; the spec does not define its content. | sars_declaration_events | sars_declaration_events.signature_document_id (pointer to files service) | Emit the agreed signature representation once confirmed. | Omit if unsigned. | Signature string content SARS expects (SARS) and DEEDLY signature UX (Louis/Product). |
| /TransferDutyReturn/SellersDeclarations/SellerDeclaration/DeclarationDate | date | 0..1 | Optional. | sars_declaration_events | sars_declaration_events.declaration_date | ISO-8601 date. | Omit if not declared. |  |

### Purchasers Declarations

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/PurchasersDeclarations | PurchasersDeclarations wrapper (anonymous sequence) | 0..1 | Optional container. | sars_declaration_events | sars_declaration_events where declaration_type=purchaser | One PurchaserDeclaration per purchaser declaration. | Omit if no purchaser declarations. | — |
| /TransferDutyReturn/PurchasersDeclarations/PurchaserDeclaration | SimpleDeclarationStructure | 1..30 | One per purchaser declaration. | sars_declaration_events | sars_declaration_events row | Populate SimpleDeclarationStructure. | Omit if not declared. |  |
| /TransferDutyReturn/PurchasersDeclarations/PurchaserDeclaration/Signature | string | 0..1 | Optional. | sars_declaration_events | signature_document_id | Same as seller signature. | Omit if unsigned. | Same as seller signature — see SellerDeclaration.Signature. |
| /TransferDutyReturn/PurchasersDeclarations/PurchaserDeclaration/DeclarationDate | date | 0..1 | Optional. | sars_declaration_events | sars_declaration_events.declaration_date | ISO-8601 date. | Omit if not declared. |  |

### Conveyancer Declaration

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/ConveyancerDeclaration | SimpleDeclarationStructure | 0..1 | Optional container. | sars_declaration_events | sars_declaration_events where declaration_type=conveyancer | Populate SimpleDeclarationStructure. | Omit if not declared. | — |
| /TransferDutyReturn/ConveyancerDeclaration/Signature | string | 0..1 | Optional. | sars_declaration_events | signature_document_id | Same as seller signature. | Omit if unsigned. | Same as seller signature — see SellerDeclaration.Signature. |
| /TransferDutyReturn/ConveyancerDeclaration/DeclarationDate | date | 0..1 | Optional. | sars_declaration_events | sars_declaration_events.declaration_date | ISO-8601 date. | Omit if not declared. |  |

### Assessment Type

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/AssessmentType | string (enum: CONFIRMATION, ASSESSMENT_NOTICE, EXEMPTION_CERTIFICATE, RECEIPT, PAYMENT_RD) | 0..1 | Response-side only. | SARS | SARS assessment response | Use SARS return value. | Omit for outbound submission. | — |

### Receipt Details

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/ReceiptDetails | ReceiptStructure | 0..1 | Optional; **SARS-populated output** — spec §4.19: receipt fields are locked/populated, receipt number populated when amount > R0.00. Never user-entered. | SARS | SARS receipt response | Pass through SARS-supplied values only. | Omit for outbound submission. | — |
| /TransferDutyReturn/ReceiptDetails/ReceiptNo | string (pattern: \d{9}) | 0..1 | Response-side only — SARS-populated when receipt amount > R0.00. | SARS | SARS receipt response | 9 digits. | Omit for outbound. | — |
| /TransferDutyReturn/ReceiptDetails/ReceiptAmt | FinancialAmtDecimalType (totalDigits: 17; fractionDigits: 2) | 1..1 | Response-side only — SARS-populated. | SARS | SARS receipt response | Decimal 17,2. | Omit for outbound. | — |

### Additional Conveyancer Declaration

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/AdditionalConveyancerDeclaration | SimpleDeclarationStructure | 0..1 | Optional container. | sars_declaration_events | sars_declaration_events where declaration_type=additional_conveyancer | Populate SimpleDeclarationStructure. | Omit if not declared. | — |
| /TransferDutyReturn/AdditionalConveyancerDeclaration/Signature | string | 0..1 | Optional. | sars_declaration_events | signature_document_id | Same as seller signature. | Omit if unsigned. | Same as seller signature — see SellerDeclaration.Signature. |
| /TransferDutyReturn/AdditionalConveyancerDeclaration/DeclarationDate | date | 0..1 | Optional. | sars_declaration_events | sars_declaration_events.declaration_date | ISO-8601 date. | Omit if not declared. |  |

### Revision Number

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/RevisionNo | VersionNoType (pattern: \d{0,5}) | 0..1 | Optional; SARS system/resubmission. | sars_submissions / SARS | sars_submissions revision counter or SARS response | \d{0,5} | Omit for first outbound. | — |

### Form Info (Enterprise)

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/FormInfo | FormInfoStructure | 0..1 | Optional; SARS/system envelope. | SARS / DEEDLY runtime | Runtime metadata (form id, timestamp) | Pass through if required by SARS integration layer. | Omit for outbound submission unless SARS/Clive specifies. | Which Enterprise FormInfo fields DEEDLY must populate. |
| /TransferDutyReturn/FormInfo/FormID | string | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/TimeStamp | dateTime | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/VersionNo | string | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/HasSupportDocs | string | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/Signed | string | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/Incomplete | string | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/TaxYear | YearType (pattern: \d{4}) | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/FormYear | YearType (pattern: \d{4}) | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/TaxRefNo | TaxRefNoType (pattern: \w{8}\|\w{10}) | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/Language | decimal (minInclusive: 0; maxInclusive: 99) | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/Area | AreaType (pattern: \d{0,4}) | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/SourceID | string | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/SubmitUrl | string | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/SaveUrl | string | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/SaveUrlWs | string | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/CalculateUrl | string | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/FormType | FormTypeType (maxLength: 59) | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/RevisionNo | string | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/ITID | decimal (minInclusive: -9223372036854775808; maxInclusive: 9223372036854775807) | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/WizardID | decimal (minInclusive: -9223372036854775808; maxInclusive: 9223372036854775807) | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/UserRights | string | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/IsOnline | string | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/UniqueRef | UniqueIdentifierType (pattern: [A-F\|a-f\|0-9\|\-]{0,64}) | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/ReadOnly | string | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/Metadata | MetadataStructure | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/Metadata/ApplicationMetadata | ApplicationMetadataStructure | 0..unbounded |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/Metadata/ApplicationMetadata/Data | DataStructure | 0..unbounded |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/Metadata/ApplicationMetadata/Data/Name | string | 1..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/Metadata/ApplicationMetadata/Data/Value | string | 1..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/Metadata/Username | UsernameType (maxLength: 32) | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/Metadata/TimeStamp | dateTime | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/CurCalenderYear | YearType (pattern: \d{4}) | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/DateReceived | dateTime | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/Hash | HashType | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/SignatureBiometric | SignatureBiometricStructure | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/SignatureBiometric/Signature | SignatureType | 1..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/SignatureBiometric/Image | string | 1..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/ScanningVersion | string (maxLength: 4) | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/PartyID | string (maxLength: 20) | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/CaseNo | CaseNoType (pattern: \d{0,10}) | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/TransactionDate | date | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/FormInfo/PrintIndicator | string (enum: SARS, TAXPAYER) | 0..1 |  |  |  |  |  |  |

### Security Info (Enterprise)

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/SecurityInfo | SecurityInfoStructure | 0..1 | Optional; authentication envelope. | SARS / DEEDLY runtime | S2S security context | Pass through. | Omit for outbound submission unless SARS integration layer requires it. | SecurityInfo content for live SARS connectivity (out of scope). |
| /TransferDutyReturn/SecurityInfo/SessionID | string | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/SecurityInfo/TaxUserID | string | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/SecurityInfo/TaxPayerID | string | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/SecurityInfo/ReturnGroupID | string | 0..1 |  |  |  |  |  |  |

### Metadata

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/Metadata | MetadataStructure | 0..1 | Optional; application metadata. | DEEDLY runtime | Application name, username, timestamp | Key/value string pairs. | Omit for outbound submission unless required. | — |
| /TransferDutyReturn/Metadata/ApplicationMetadata | ApplicationMetadataStructure | 0..unbounded |  |  |  |  |  |  |
| /TransferDutyReturn/Metadata/ApplicationMetadata/Data | DataStructure | 0..unbounded |  |  |  |  |  |  |
| /TransferDutyReturn/Metadata/ApplicationMetadata/Data/Name | string | 1..1 |  |  |  |  |  |  |
| /TransferDutyReturn/Metadata/ApplicationMetadata/Data/Value | string | 1..1 |  |  |  |  |  |  |
| /TransferDutyReturn/Metadata/Username | UsernameType (maxLength: 32) | 0..1 |  |  |  |  |  |  |
| /TransferDutyReturn/Metadata/TimeStamp | dateTime | 0..1 |  |  |  |  |  |  |

### Form Wizard

| SARS V1.17 Path | XSD Type | Cardinality | Phase 3 Rule | DEEDLY Owner | DEEDLY Source | Transformation | Omission Rule | Unresolved Dependency |
|---|---|---|---|---|---|---|---|---|
| /TransferDutyReturn/FormWizard | FormWizardStructure | 1..1 | Required — mirrors the spec §4.2.4 wizard selections that drive the read-only `TransactionType`. Group 1: Normal/Donation/Exchange/Partition (one selection); Group 2: Usufruct/Fideicommissum/Bare Dominium/Usus/Habitatio each with Acquisition/Renunciation subtype; exemption branch separate. | transfers / wizard model | Wizard selection object | Populate FormWizardStructure from the selection. | Cannot omit; readiness blocker. | How DEEDLY captures the wizard selection (Louis/Product) and which TransactionType label each combination emits (SARS). |
| /TransferDutyReturn/FormWizard/TransferDutyType | TransferDutyType (enum: UNIDIVIDED_PROPERTY_TRANSFER, SHARES_MEMBERS_TRANSFER, SERVITUDES) | 0..1 | Optional — identifies the wizard type; spec removed Servitude from the wizard tab (QC 51524) though the XSD still lists it. | transfers / wizard model | Derived from wizard selection. | Map to UNIDIVIDED_PROPERTY_TRANSFER / SHARES_MEMBERS_TRANSFER / SERVITUDES. | Omit if classification unavailable. | DEEDLY matter/transfer classification → SARS TransferDutyType mapping (Clive/Entities). |
| /TransferDutyReturn/FormWizard/NormalInd | YesNoIndType (enum: Y, N) | 0..1 | Optional — wizard Group 1 flag ('Normal'). | wizard model | Wizard selection. | bool → Y/N | Omit if not selected. | — |
| /TransferDutyReturn/FormWizard/DonationInd | YesNoIndType (enum: Y, N) | 0..1 | Optional — wizard Group 1 flag ('Donation'). | wizard model | Wizard selection. | bool → Y/N | Omit if not selected. | — |
| /TransferDutyReturn/FormWizard/ExchangeInd | YesNoIndType (enum: Y, N) | 0..1 | Optional — wizard Group 1 flag ('Exchange'); when set, the related-exchange block and second-submission rules apply. | wizard model | Wizard selection. | bool → Y/N | Omit if not selected. | — |
| /TransferDutyReturn/FormWizard/PatitionInd | YesNoIndType (enum: Y, N) | 0..1 | Optional — wizard Group 1 flag ('Partition'). | wizard model | Wizard selection. | bool → Y/N | Omit if not selected. | — |
| /TransferDutyReturn/FormWizard/UsurfructInd | YesNoIndType (enum: Y, N) | 0..1 | Optional — wizard Group 2 flag ('Usufruct'). | wizard model | Wizard selection. | bool → Y/N | Omit if not selected. | — |
| /TransferDutyReturn/FormWizard/UsurfructType | AcquisitionRenunciationType (enum: ACQUISITION, RENUNCIATION) | 0..1 | Optional — Usufruct Acquisition/Renunciation subtype. | wizard model | Wizard selection. | ACQUISITION/RENUNCIATION | Omit if Usufruct not selected. | — |
| /TransferDutyReturn/FormWizard/BaredominiumInd | YesNoIndType (enum: Y, N) | 0..1 | Optional — wizard Group 2 flag ('Bare Dominium'). | wizard model | Wizard selection. | bool → Y/N | Omit if not selected. | — |
| /TransferDutyReturn/FormWizard/BaredominiumType | AcquisitionRenunciationType (enum: ACQUISITION, RENUNCIATION) | 0..1 | Optional — Bare Dominium Acquisition/Renunciation subtype. | wizard model | Wizard selection. | ACQUISITION/RENUNCIATION | Omit if Bare Dominium not selected. | — |
| /TransferDutyReturn/FormWizard/FideicommissiumInd | YesNoIndType (enum: Y, N) | 0..1 | Optional — wizard Group 2 flag ('Fideicommissum'). | wizard model | Wizard selection. | bool → Y/N | Omit if not selected. | — |
| /TransferDutyReturn/FormWizard/FideicommissiumType | AcquisitionRenunciationType (enum: ACQUISITION, RENUNCIATION) | 0..1 | Optional — Fideicommissum Acquisition/Renunciation subtype. | wizard model | Wizard selection. | ACQUISITION/RENUNCIATION | Omit if Fideicommissum not selected. | — |
| /TransferDutyReturn/FormWizard/UsusInd | YesNoIndType (enum: Y, N) | 0..1 | Optional — wizard Group 2 flag ('Usus'). | wizard model | Wizard selection. | bool → Y/N | Omit if not selected. | — |
| /TransferDutyReturn/FormWizard/UsusType | AcquisitionRenunciationType (enum: ACQUISITION, RENUNCIATION) | 0..1 | Optional — Usus Acquisition/Renunciation subtype. | wizard model | Wizard selection. | ACQUISITION/RENUNCIATION | Omit if Usus not selected. | — |
| /TransferDutyReturn/FormWizard/HabitatioInd | YesNoIndType (enum: Y, N) | 0..1 | Optional — wizard Group 2 flag ('Habitatio'). | wizard model | Wizard selection. | bool → Y/N | Omit if not selected. | — |
| /TransferDutyReturn/FormWizard/HabitatioType | AcquisitionRenunciationType (enum: ACQUISITION, RENUNCIATION) | 0..1 | Optional — Habitatio Acquisition/Renunciation subtype. | wizard model | Wizard selection. | ACQUISITION/RENUNCIATION | Omit if Habitatio not selected. | — |
| /TransferDutyReturn/FormWizard/ResidentialPropertyCompanyTransferInd | YesNoIndType (enum: Y, N) | 0..1 | Optional — wizard flag 'Residential Property Company Transfer'. | wizard model | Wizard selection. | bool → Y/N | Omit if not selected. | — |
| /TransferDutyReturn/FormWizard/ExemptInd | YesNoIndType (enum: Y, N) | 0..1 | Optional — wizard 'Exempt' flag; when Y, the exemption branch (Section 9 list / other-act details) applies. | sars_submissions | Derived from exemption fields. | bool → Y/N | Omit if not exempt. | — |
| /TransferDutyReturn/FormWizard/ExemptType | string (maxLength: 35) | 0..1 | Optional. | sars_submissions | exemption type text | Trim to 35 chars. | Omit if ExemptInd != Y. |  |
| /TransferDutyReturn/FormWizard/NoOfSellers | decimal (minInclusive: 0; maxInclusive: 30) | 0..1 | Optional. | transfer_parties | count of transfer_parties where role in (seller, transferor) | Integer 0..30 | Omit if zero. |  |
| /TransferDutyReturn/FormWizard/NoOfExistingShareholders | decimal (minInclusive: 0; maxInclusive: 30) | 0..1 | Optional — count only; V1.17 removed the existing-shareholder structures (see §9 version skew). | transfer_parties | count of role existing_shareholder | Integer 0..30 | Omit if zero. | Whether counts alone satisfy the live channel or the removed structures are still required (SARS). |
| /TransferDutyReturn/FormWizard/NoOfBuyers | decimal (minInclusive: 0; maxInclusive: 30) | 0..1 | Optional. | transfer_parties | count of transfer_parties where role in (buyer, transferee) | Integer 0..30 | Omit if zero. |  |
| /TransferDutyReturn/FormWizard/NoOfNewShareholders | decimal (minInclusive: 0; maxInclusive: 30) | 0..1 | Optional — count only; V1.17 removed the new-shareholder structures (see §9 version skew). | transfer_parties | count of role new_shareholder | Integer 0..30 | Omit if zero. | Whether counts alone satisfy the live channel or the removed structures are still required (SARS). |
| /TransferDutyReturn/FormWizard/NoOfEstateAgents | decimal (minInclusive: 0; maxInclusive: 10) | 0..1 | Optional. | transfer_parties | count of role estate_agent | Integer 0..10 | Omit if zero. |  |

## 5. Implementable Mappings

These fields have a deterministic DEEDLY source and a known XSD/functional constraint; they can be wired as soon as the serializer is rewritten:

- `SourceSoftware`, `RevisionNo` booleans/numbers.  
- Seller/buyer/estate-agent counts and all wizard flags in `FormWizard` once a wizard-selection model exists.  
- Related-exchange block (`RelatedExchangeDocumentNo`, root `TotalFairValueAmt`, `AnyOtherConsiderationAmt`) from `sars_submissions.related_exchange_*`, gated on the Exchange wizard selection.  
- `DutyInterestPayable` totals and `NaturalPersons`/`NonNaturalPersons` allocations from `sars_calculations.party_allocations` (calculated/locked fields).  
- `PropertyDetails/SellingPriceAmt`, `OtherConsiderationAmt`, `MonthlyRentalAmt`, `LandValueAmt`, `OccupationalRentAmt`, `ImprovementValueAmt`, `TotalFairAmt`, `TotalConsiderationAmt` from `sars_property_details` / `sars_calculations`.  
- Property indicator codes confirmed by the ICC mapping: `PropertyImprovementInd` (`I`/`U`), `BoughtByInd` (`T`/`A`/`O`), `PropertyUsageInd` (`P`/`L`/`B`/`O`), `PropertyNatureInd` (`P`/`R`/`S`/`C`/`I`/`M`/`O`/`F`).  
- VAT block conditionality: `VATRateInd` (`S`/`Z`), `VATDeclarationPeriod` (CCYYMM gated on `VATPurposeInd`), `GoingConcernPayableAmt` (gated on enterprise-asset + zero rate), purchaser `VATRefNo` mandatory when `Z`.  
- `VDPApplication` with `VDPApplicationNo` format `VDP` + 6 digits + modulus-9 check digit.  
- `SellersDeclarations`/`PurchasersDeclarations`/`ConveyancerDeclaration` dates from `sars_declaration_events`.  
- Boolean-to-Y/N conversions for `NotRegForIncomeTaxInd`, `NaturalPersonInd`, `ConnectedPersonInd`, `VDPIndicator` and the `YesNoIndType` fields.  
- Decimal formatting for `FinancialAmtDecimalType` (17 total digits, 2 fraction digits) and `PercentageType` (5 total, 2 fraction).  
- Functional masks now documented: `TDReferenceNo` (`TD`+`E`+`0`+6 hex), `DeedsNo` (title-deed mask), `VDPApplicationNo` (`VDP`+modulus-9).

## 6. Open Contract Decisions (post full-document review)

After the full review of the supplied SARS bundle, the following remain genuinely unresolved. Grouped by proposed owner.

### SARS / Mdu

1. **`TDReferenceNo` issuance flow** — the field is required inside `TransferDutyReturn`, carries mask `TD`+`E`+`0`+6 hex, and is system-populated/locked (`Cross_InitialLocked`); the ISV spec returns `TDReferenceNum` after `SubmitTransferDuty`. Which operation issues the initial reference for a first submission, and is it required only on corrections/resubmissions?
2. **`TransactionType` label vocabulary** — it is read-only and pre-populated from the wizard selection (`Pre_Pop_Wizard`, e.g. "Bare Dominium Acquired"). What is the exact label each wizard combination produces?
3. **Declaration `Signature` content** — a plain `string` element; no document defines whether it should carry a signer name, a document reference, or an attestation token.
4. **Authoritative schema for the live channel** — the bundled V1.17 XSD removed `PresentShareholdersDetails`/`NewShareholdersDetails` and `FaxNo`, and its `EntityTypeType` lacks values listed in the ICC/Phase workbooks (`SOUTH_AFRICAN_RESIDENT`, `SOUTH AFRICAN_NON_RESIDENT`, `FOREIGNER_NON_RESIDENT`, `NORMAL_TRUST`, `UNICORPORATED_BODY_OF_PERSONS`, `CONVEYANCER`). Which contract does the live endpoint validate against?
5. **Envelope/system elements** — `FinancialAccount`, `SourceSoftware`, `FormInfo`, `SecurityInfo`, `Metadata`, `RevisionNo`, `AssessmentType`, `ReceiptDetails`: which must be populated or echoed on submission and on corrections?
6. **`DeedsNo` container placement** — the 2021 change log says Title Deed belongs under the **seller** container; the current spec body (§4.7.1) places it under **purchaser**. Which is authoritative?

### Clive / Entities

7. **`NatureOfPerson` mapping table** — DEEDLY/GR entity kind (`person`/`company`/`trust` + residency/registration subtype) → `EntityTypeType`; which values make `IncomeTaxRefNo` non-mandatory.
8. **Company tax-identifier disambiguation** — authoritative GR fields for `IncomeTaxRefNo` vs `VATRefNo` vs `RegistrationNo`.
9. **Country code set** — `PassportCountryCode`/`SpousePassportCountryCode` use spec Appendix E codes; confirm GR stores compatible values.
10. **Conditional identity fields** — exact GR fields for `AnnualIncomeAmt`, `Gender`, `MaritalStatus`, spouse identity (`SpouseInitials`/`SpouseIDNo`/`SpousePassportNo`/`SpousePassportCountryCode`) and `CountryOfResidence`.
11. **Estate agent identity** — whether agents are Golden Record parties or matter-captured contacts (spec needs surname/initials/tax no, not full GR identity).
12. **`TransferDutyType` mapping** — DEEDLY matter/transfer classification → `UNIDIVIDED_PROPERTY_TRANSFER` / `SHARES_MEMBERS_TRANSFER` / `SERVITUDES`.

### Louis / Product

13. **Wizard UX** — how DEEDLY captures the §4.2.4 transaction-type wizard selection (Group 1/Group 2 + acquisition/renunciation + exempt branch) so `FormWizard` and `TransactionType` can be derived.
14. **`VATDeclarationPeriod`** — which entity's VAT201 period is intended and how it should be captured/estimated (CCYYMM).
15. **Valuation capture** — whether to add `LocalValuationAmt`, `BondAmt`, `PropertyValueAmt` as structured SARS property fields.
16. **Estate agent commission** — where `CommissionPayable` (incl. VAT) is captured.
17. **Declaration signature UX** — signature box vs uploaded document until SARS confirms the expected string content.

### Internal DEEDLY decision

18. **`DeedsNo` source field** — `properties.title_deed_number` is the presumed source; confirm which recorded deed number is emitted.
19. **`SourceSoftware` values** — the DEEDLY product name/version strings to emit.
20. **Estimate vs SARS-populated persistence** — whether SARS-calculated duty/receipt values are written back into `sars_calculations` or kept snapshot-only.
21. **`PropertyDesc` content** — which stored description (legal description vs generated) feeds the property description lines.

## 7. Transformations and Enums to Centralize

A `sars_value_maps.py` module should own the following conversions and validation, not the serializer:

1. `bool -> YesNoIndType` (`True/False` → `Y`/`N`).  
2. `entity_type + GR kind -> EntityTypeType` (27-value lookup).  
3. `DEEDLY classification -> TransferDutyType` (`UNIDIVIDED_PROPERTY_TRANSFER`, `SHARES_MEMBERS_TRANSFER`, `SERVITUDES`).  
4. `DEEDLY classification / terms -> TransactionType` string (max 100).  
5. `gender -> GenderType` (`M`/`F`).  
6. `marital_status -> MaritalStatusType` (`N`/`I`/`O`/`D`).  
7. `id_number -> IDNo` (13-digit South African ID validation).  
8. `tax_number/vat_number -> TaxRefNoType` (8 or 10 word chars).  
9. `country_code -> CountryType` (3-char SARS pattern).  
10. `property indicators -> IndicatorType` single-char mapping.  
11. `not_registered_reason -> NotRegisteredReasonType` enum.  
12. Decimal normalization for `FinancialAmtDecimalType` and `PercentageType`.

## 8. Proposed Golden XML Fixtures

### Positive (golden) fixtures

1. `valid_natural_person_sale.xml` — one individual seller, one individual purchaser, natural-property transfer, no VAT, with TDReferenceNo, TransactionType, FormWizard, SellingPriceAmt, DutyInterestPayable and declarations.  
2. `valid_company_purchase.xml` — `PRIVATE_CO` purchaser, `INDIVIDUAL` seller, VAT `S`, `GoingConcernPayableAmt`.  
3. `valid_vdp_submission.xml` — `VDPIndicator = Y`, `VDPApplicationNo` populated.  
4. `valid_estate_agent.xml` — estate agent party, `EstateAgenciesDetails` with commission.  
5. `valid_shares_transfer.xml` — `TransferDutyType = SHARES_MEMBERS_TRANSFER` with existing/new shareholder counts only (structures removed).

### Negative fixtures

1. `missing_namespace.xml` — root has no target namespace.  
2. `missing_required.xml` — omit `TDReferenceNo` or `TransactionType` or `FormWizard`.  
3. `invalid_exempt.xml` — `ExemptInd = X`.  
4. `invalid_idno.xml` — `IDNo` with 12 or 14 digits.  
5. `invalid_taxref.xml` — 7-character tax reference.  
6. `invalid_gender.xml` — `Gender = U`.  
7. `invalid_marital.xml` — `MaritalStatus = X`.  
8. `invalid_entity_type.xml` — `NatureOfPerson = TRUST` (not in enum).  
9. `invalid_vat_rate.xml` — `VATRateInd = A`.  
10. `invalid_deeds_no_length.xml` — `DeedsNo` > 30 chars.  
11. `selling_price_missing.xml` — `PropertyDetails` without `SellingPriceAmt`.  
12. `percentage_overflow.xml` — `SharePercentage` with 3 fraction digits.  
13. `source_software_missing_child.xml` — `SourceSoftware` without `Version`.

## 9. Discrepancies Between Phase 2/3 Mapping and the Actual V1.17 XSD

1. **Root element**: Phase 2 serializer emitted `<sars-transfer-duty-return>`; XSD requires `<TransferDutyReturn>` with the SARS V1.13 namespace.  
2. **Internal ownership groups**: Phase 2 payload is a generic `ownership_groups` dictionary; XSD requires named SARS elements (`SellersDetails`, `PurchasersDetails`, `PropertyDetails`, etc.).  
3. **Shareholder structures removed**: V1.17 XSD documentation states "Removed New Shareholders and existing Shareholders structures". Only `NoOfExistingShareholders` / `NoOfNewShareholders` counts remain in `FormWizard`. DEEDLY migration 022 still seeds `existing_shareholder`/`new_shareholder` roles, which now have no direct XML target.  
4. **NatureOfPerson is mandatory**: XSD requires `NatureOfPerson` for every `SellerDetails`/`PurchaserDetails`; Phase 2 did not model this.  
5. **TransactionType is mandatory and max 100 chars**: Phase 2 did not source it. The functional spec confirms it is read-only and pre-populated from the wizard selection (`Pre_Pop_Wizard`).  
6. **FormWizard is mandatory**: Phase 2 did not emit it.  
7. **Property indicators are single-char `IndicatorType`**: Phase 2 fields are free-text `VARCHAR(20)`; the ICC mapping supplies the confirmed single-char value sets (`I`/`U`, `T`/`A`/`O`, `P`/`L`/`B`/`O`, `P`/`R`/`S`/`C`/`I`/`M`/`O`/`F`).  
8. **`TotalFairValueAmt` appears twice**: the root instance is the **related-exchange** value (EXCH01); the `PropertyDetails/TotalFairAmt` instance is the **property valuation** field. Phase 2 only stored one value.  
9. **Company/trust party identity**: XSD distinguishes `IncomeTaxRefNo`, `VATRefNo`, `RegistrationNo`; Phase 2 conflates tax/VAT.  
10. **VAT block**: XSD has `VATRateInd` (`Z`/`S`), `IncludingVATInd`, `VATDeclarationPeriod`, `OutputTaxPayableAmt`, `GoingConcernPayableAmt`; Phase 2 only stored `is_vat_transaction` plus one `vat_rate_indicator`.

### Version skew between the supplied SARS artifacts

The supplied documentation and the bundled `SARSTransferDutyReturnV1.17.xsd` are not fully aligned. These differences are recorded, not resolved — no artifact is preferred over another unless the documentation establishes precedence (the Phase 3 Source Basis sheet names the functional spec as the authoritative *business-rule* source and the XSD is what the local validator enforces for *structure*):

1. **Shareholder structures** — the ICC mapping workbook and the ISV spec both map `PresentShareholdersDetails` and `NewShareholdersDetails`; the bundled V1.17 XSD removed them (change note 2025-09-02). Only the `FormWizard` counts remain.  
2. **`FaxNo` fields** — the ICC mapping lists `FaxNo` for both `ConveyancerDetails` and `EstateAgencyDetails`; the bundled XSD omits them, consistent with the spec change log entry "Hide the Fax number" (QC 51896).  
3. **`EntityTypeType` enumeration** — the ICC/Phase workbooks list additional values not present in the bundled XSD's 27-value `EntityTypeType` (`SOUTH_AFRICAN_RESIDENT`, `SOUTH AFRICAN_NON_RESIDENT`, `FOREIGNER_NON_RESIDENT`, `NORMAL_TRUST`, `UNICORPORATED_BODY_OF_PERSONS`, `CONVEYANCER`, and others). The mapping table must be confirmed against the contract the live channel validates.  
4. **`YesNoBlankIndType` vs `YesNoIndType`** — the workbooks type `VDPIndicator` and `IncludingVATInd` as `YesNoBlankIndType`; the bundled XSD uses `YesNoIndType` (`Y`/`N`).  
5. **`PercentageType` precision** — the workbooks show `totalDigits: 3`; the bundled XSD uses `totalDigits: 5, fractionDigits: 2`.  
6. **`DeedsNo` placement** — the 2021 change log moves Title Deed to the seller container; the current spec body keeps it under purchaser (§4.7.1). The shared `PropertyRepresentativeStructure` exposes it on both.  
7. **Field lengths** — several form lengths differ from XSD maxima (`Surname` A(37) vs 53; `Fullname` A(50) vs 90; `RegistrationNo` A(12) vs 15; `PropertyDesc` A(212) vs 530; `CellNo` N(10) vs `\d{0,15}`). The XSD values are the validation ceiling; the form lengths are the functional expectation.
