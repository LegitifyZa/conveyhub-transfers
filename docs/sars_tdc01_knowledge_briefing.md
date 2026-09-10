# SARS TDC01 — Knowledge Briefing Pack

**Date:** 8 September 2026
**Branch:** `deedly/mvp1/sars-integration/tdc01-foundation` (unmerged)
**Mode:** Knowledge acquisition only — no code changes, no live SARS connectivity.

## 1. Documents reviewed

| Source | File | Role |
|---|---|---|
| SARS TDC01 Functional Spec | `SARS_FunctionalSpecification_TDC01_v2025.05.00.pdf` (188 pages) | Authoritative field-level business rules: mandatory/conditional behaviour, wizard logic, masks and cross-field rules. |
| SARS ICC form→XSD mapping | `SARS_ICC_TD01_Form_Mapping_To_SARSTransferDutyReturnV1.0.xlsx` | Field-by-field mapping from TD01 form codes to `SARSTransferDutyReturnV1.17.xsd` XPaths, types and enumerations. |
| SARS ISV Integration API spec | `SARS_2024_ISV Integration API Interface SpecificationV9.6.docx` | eFiling ISV channel: security model, `SubmitTransferDuty`, correspondence/status/document/estimation operations, async batch behaviour. |
| SARS XSD package | `ISV_Schema_Transferduty.zip` (already vendored under `python_server/resources/sars/`) | Authoritative V1.17 XML contract used by `SarsXmlValidator`. |
| DEEDLY implementation spec | `DEEDLY_SARS_TDC01_Implementation_Specification_for_Devin.md` | Already implemented foundation: tables, services, boundaries, semantic gates. |
| DEEDLY Phase 2 workbook | `DEEDLY_SARS_Transfer_Duty_Phase2_XPath_Master_Mapping.xlsx` | 183-field XPath register with DEEDLY owner/source/status. |
| DEEDLY Phase 3 workbook | `DEEDLY_SARS_Transfer_Duty_Phase3_Functional_Rule_Mapping.xlsx` | Functional-rule overlay: 66 mandatory / 84 conditional / 25 rule-driven rows; 8 rows unmatched for manual review. |

## 2. What I learned

### 2.1 The integration landscape is a two-layer model

- **Transport layer (ISV spec):** legacy eFiling vendor channel — `VendorCode` + `ApplicationKey` → `GetToken`; `AccessKey` = AES-encrypted `token|username|loginKey` (30-minute token); async batch submission via a `TransferDuty` webservice. Relevant operations: `SubmitTransferDuty`, `RequestCorrespondenceTD`, `RequestSARSStatusTD`, `RequestDocumentTD`, `SubmitSupportingDocumentTD`, `RequestEstimationTD`. Submissions queue, then return `TDReferenceNum`, `Status` (`QUEUED`/`FAILED`) and `Errors`.
- **Payload layer (V1.17 XSD):** the inner `<TransferDutyReturn>` in namespace `.../TransferDutyReturn/xml/schemas/version/1.13`, wrapped in a `root/customer/ReturnHeader/ReturnData` envelope at transport time. `TDReferenceNo` inside the XSD is the same identifier family as `TDReferenceNum` returned by the transport.

### 2.2 Several previous "gates" are partially resolved by the documents

- **`TransactionType`** = the *"Transaction Type Purchased"* field (TRTY01). It is **read-only and pre-populated from the wizard selection** (e.g. "Bare Dominium Acquired"). So `FormWizard` is the driver and `TransactionType` is a derived label — not free text.
- **`TDReferenceNo`** has a fixed mask: positions 1–2 `TD`, position 3 `E` (eFiling), position 4 `0`, positions 5–10 hexadecimal. It is `Cross_InitialLocked` — system-populated/locked in the form — consistent with it being SARS-issued (the transport returns `TDReferenceNum` after queueing).
- **`DeedsNo`** is the **Title Deed No.** under *purchaser/transferee* details. Functionally **mandatory** with a strict mask (min 7 chars, must contain specials like `-`/`/`, first char alpha excluding D/J/O/R/Y/Z, `/` followed by a valid CCYY year, no spaces). The XSD alone (max 30, min 0) understates this.
- **VAT block semantics confirmed:** `VATRateInd` = `S` (standard) / `Z` (zero). `VATDeclarationPeriod` = the estimated VAT201 output-tax period in **CCYYMM** (6 digits), mandatory when *"Is the property an enterprise asset for VAT purpose?"* = Yes. `InputTaxClaimedInd` is conditional on the same question. `GoingConcernPayableAmt` is mandatory when enterprise-asset = Yes **and** zero rate selected — i.e. the zero-rated going-concern amount. Zero rate also makes the **purchaser's `VATRefNo`** mandatory (`Cross_Mandatory_ZeroRate`). Property VAT is explicitly separate from attorney-fee VAT.
- **Root `TotalFairValueAmt` / `AnyOtherConsiderationAmt`** belong to the **related exchange transaction** container (EXCH01), not the current property. They display only when *Exchange* is selected and the second form is submitted; Total Fair Value or Other Consideration must be completed, and Total Fair Value ≥ Total Consideration. These map cleanly to `sars_submissions.related_exchange_total_fair_value` / `related_exchange_other_consideration` / `related_exchange_sars_reference_no`.
- **Duty allocation rows** (`NaturalPerson`/`NonNaturalPerson` % / amount / calculated, up to 8 each) are `Cross_InitialLocked` — calculated/populated values, not free input. This matches the `sars_calculations.party_allocations` design.
- **Declarations:** signature is a plain `string` element — the documents do not define its content. Still needs confirmation (signature token? document reference? PIN-style attestation?).
- **VDP:** `VDPIndicator` is mandatory Y/N in the form; when `Y`, `VDPApplicationNo` unlocks and becomes mandatory with format `VDP` + 6 digits + 1 modulus-9 check digit (10 chars). The XSD pattern `\w{0,10}` is looser than the functional rule.
- **Exemptions:** Section 9 exemption is a list selection; selecting "Other" makes the other-act details mandatory (act name/number/applicable section).
- **Wizard logic:** Group 1 — Normal/Donation/Exchange/Partition (one selection). Group 2 — Usufruct/Fideicommissum/Bare Dominium/Usus/Habitatio, each with an Acquisition/Renunciation subtype; limited combinations across groups. `FormWizard` mirrors these flags (`NormalInd`, `DonationInd`, `ExchangeInd`, `PatitionInd`, `UsurfructInd`/`UsurfructType`, `BaredominiumInd`/`BaredominiumType`, `FideicommissiumInd`/`FideicommissiumType`, `UsusInd`/`UsusType`, `HabitatioInd`/`HabitatioType`, `ResidentialPropertyCompanyTransferInd`, `ExemptInd`/`ExemptType`, plus the five count fields).
- **Cardinality:** sellers 1–30, purchasers 1–30, estate agents 0–10, property descriptions 1–500 — consistent with the XSD and already reflected in the readiness model.
- **Phase 3 register quality:** 183 XPath rows; 175 matched, 0 review-match, 8 unmatched — the 8 unmatched rows (natural/non-natural allocation fields, output-tax period, other-act exemption detail) were manually resolved in the implementation spec §9.1.

### 2.3 Version skew worth noting

- The ICC mapping workbook and the ISV spec reference `PresentShareholdersDetails` and `NewShareholdersDetails` structures and `ConveyancerDetails.FaxNo` / `EstateAgencyDetails.FaxNo`, plus a larger `EntityTypeType` list (`SOUTH_AFRICAN_RESIDENT`, `SOUTH AFRICAN_NON_RESIDENT`, `FOREIGNER_NON_RESIDENT`, `NORMAL_TRUST`, `UNICORPORATED_BODY_OF_PERSONS`, `CONVEYANCER`, etc.).
- The **bundled V1.17 XSD removed** the shareholder structures (2025-09-02 note) and the `FaxNo` elements, and its `EntityTypeType` has 27 values without those extra members.
- The mapping workbooks also use `YesNoBlankIndType` for `VDPIndicator`/`IncludingVATInd` and `PercentageType` with totalDigits 3, while the bundled XSD uses `YesNoIndType` and totalDigits 5/fraction 2. The bundled XSD is the contract our validator enforces; the workbook entries are documentation, not schema.

## 3. Remaining open questions (for SARS / Clive / dev environment)

1. **`TDReferenceNo` lifecycle:** it is required inside `TransferDutyReturn` yet described as system-populated/locked. Which call issues it for an initial submission — a "request new return" operation, or is it returned by `SubmitTransferDuty` and only required on corrections/resubmissions?
2. **`NatureOfPerson` mapping:** the DEEDLY `person`/`company`/`trust` (+ Golden Record subtype) → `EntityTypeType` mapping needs a signed-off table, including which values make `IncomeTaxRefNo` non-mandatory and how residency variants map.
3. **`TransactionType` vocabulary:** the exact label set the wizard writes into `TransactionType` (e.g. "Bare Dominium Acquired") so we can reproduce it deterministically from `FormWizard` selections.
4. **Signature representation:** what string content SARS expects in `SellerDeclaration.Signature` / `PurchaserDeclaration.Signature` / `ConveyancerDeclaration.Signature` (and `AdditionalConveyancerDeclaration`) — literal name, document reference, or attestation token.
5. **Which XSD/enum set is authoritative:** the extra `EntityTypeType` values and `FaxNo`/`PresentShareholdersDetails`/`NewShareholdersDetails` in the workbooks vs the bundled V1.17 XSD — confirm which contract the actual eFiling/ISV endpoint validates against, and whether V1.17 is truly current for submissions.
6. **VAT declaration period source:** CCYYMM is confirmed; we need the business rule for choosing the estimated VAT201 period (which entity's VAT period — seller vendor's? — and how DEEDLY should capture it).
7. **Transport modernity:** the ISV spec is a 2015-era doc (V9.6) describing vendor tokens/AES. Confirm the current SARS channel, auth flow, endpoints and certification requirements with Clive/SARS — the spec itself warns payloads and endpoints may have changed.
8. **`FinancialAccount` / `SourceSoftware`:** neither appears in the form mapping; confirm whether the ISV envelope requires them and what values SARS expects.
9. **`AssessmentType`/`ReceiptDetails`/`RevisionNo`/`FormInfo`/`SecurityInfo`/`Metadata`:** response/system-side elements — confirm which must be echoed on corrections/resubmissions.

## 4. Suggestions for later

1. **Update the serializer contract doc** (`docs/sars_tdc01_serializer_contract.md`) with the newly resolved semantics: related-exchange root amounts, `DeedsNo` = purchaser title-deed number with mask, `VATRateInd` S/Z meaning, `VATDeclarationPeriod` = CCYYMM gated on `VATPurposeInd`, VDP number format `VDP######C`, and `TransactionType` as wizard-derived read-only value.
2. **Model the wizard as a first-class enum/selection object** in the payload model (Group 1 mutually exclusive; Group 2 acquisition/renunciation subtypes; exemption branch), and derive `TransactionType` + `FormWizard` counts from it rather than from free text.
3. **Add capture fields now for cheap wins:** related-exchange details already exist; add `output_tax_vat_period` (CCYYMM) and `purchaser_vat_ref_no` conditional-capture, since their rules are now known even if final SARS confirmation is pending.
4. **Extend the readiness engine** with the functional masks we now know (TD reference mask `TDE0` + 6 hex; DeedsNo mask; VDP `VDP`+modulus-9) — flagged as spec-derived rules even where the XSD is looser.
5. **Keep the ISV transport layer behind a separate seam:** the V1.17 XML is only the inner `TransferDutyReturn`; a future live-integration phase will need a `TransferDutyClient` implementing token/handshake, `SubmitTransferDuty`, status/correspondence/document polling and supporting-document upload — none of which should leak into the payload builder.
6. **Fixture plan update:** add golden fixtures for exchange-second-submission (related-exchange fields populated), zero-rated going concern (VAT `Z` + going-concern amount + purchaser VATRefNo), VDP `Y` with valid `VDP` number, and negative fixtures for the functional masks above.
7. **Declaration UX decision needed:** decide whether `Signature` carries a signer name/attestation string; persist a document reference in `sars_declaration_events` regardless until SARS confirms the expected content.
