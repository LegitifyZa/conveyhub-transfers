"""Typed SARS TDC01 V1.17 XML serializer, builder and validation tests.

These tests are isolated from the database: they exercise the typed model,
value maps, deterministic XML generation and XSD validation using in-memory
payload snapshots and mocked Golden Record data.
"""

import os
import unittest
from datetime import date
from decimal import Decimal

from models.sars_tdc01 import (
    SarsConveyancer,
    SarsDeclaration,
    SarsDutyInterestItem,
    SarsDutyInterestPayable,
    SarsFormWizard,
    SarsPropertyDetails,
    SarsPropertyRepresentative,
    SarsSourceSoftware,
    SarsTdc01Document,
)
from services.sars_tdc01_builder import SarsTdc01BuilderError, build_tdc01_document
from services.sars_tdc01_value_maps import SarsUnresolvedMappingError, normalize_id_number
from services.sars_tdc01_xml_serializer import serialize_tdc01
from services.sars_xml_validator import validate_tdc01_document, validate_tdc01_xml


class MinimalDocumentMixin:
    def _minimal_document(self) -> SarsTdc01Document:
        seller = SarsPropertyRepresentative(
            nature_of_person="INDIVIDUAL",
            fullname="John Peter Smith",
            surname="Smith",
            initials="JP",
            id_no=normalize_id_number("7701010001083"),
            gender="M",
            marital_status="N",
            share_percentage=Decimal("50.00"),
            email="john.smith@example.com",
        )
        purchaser = SarsPropertyRepresentative(
            nature_of_person="INDIVIDUAL",
            fullname="Jane Mary Doe",
            surname="Doe",
            initials="JM",
            id_no=normalize_id_number("8202020002084"),
            gender="F",
            marital_status="N",
            share_percentage=Decimal("50.00"),
            email="jane.doe@example.com",
        )
        return SarsTdc01Document(
            td_reference_no="TDE0A1B2C3",
            transaction_type="Sale",
            source_software=SarsSourceSoftware(name="DEEDLY", version="1.0.0"),
            form_wizard=SarsFormWizard(
                transfer_duty_type="UNIDIVIDED_PROPERTY_TRANSFER",
                normal_ind=True,
                no_of_sellers=1,
                no_of_buyers=1,
            ),
            sellers_details=[seller],
            purchasers_details=[purchaser],
            conveyancer_details=SarsConveyancer(
                firm="Legitify Conveyancers Inc",
                name="Conveyancer Contact",
                tel_no="0115550123",
                email="conveyancer@example.com",
            ),
            property_details=SarsPropertyDetails(
                selling_price_amt=Decimal("1500000.00"),
                total_fair_amt=Decimal("1500000.00"),
                transaction_date=date(2026, 9, 10),
            ),
            duty_interest_payable=SarsDutyInterestPayable(
                payable_amt=Decimal("15000.00"),
                natural_persons=[
                    SarsDutyInterestItem(
                        percentage=Decimal("50.00"),
                        payable_amt=Decimal("7500.00"),
                        calculated_payable_amt=Decimal("7500.00"),
                    ),
                    SarsDutyInterestItem(
                        percentage=Decimal("50.00"),
                        payable_amt=Decimal("7500.00"),
                        calculated_payable_amt=Decimal("7500.00"),
                    ),
                ],
                sub_total_payable_amt=Decimal("15000.00"),
                total_payable_amt=Decimal("15000.00"),
            ),
            sellers_declarations=[SarsDeclaration(declaration_date=date(2026, 9, 10))],
            purchasers_declarations=[SarsDeclaration(declaration_date=date(2026, 9, 10))],
            conveyancer_declaration=SarsDeclaration(declaration_date=date(2026, 9, 10)),
            property_descs=["123 Main Street, Testville"],
        )


class TypedSerializerTests(MinimalDocumentMixin, unittest.TestCase):
    def test_serialize_minimal_standard_transfer_validates(self):
        doc = self._minimal_document()
        xml = serialize_tdc01(doc)
        self.assertIn('<TransferDutyReturn', xml)
        self.assertIn('xmlns="http://www.sars.gov.za/enterpriseMessagingModel/TransferDutyReturn/xml/schemas/version/1.13"', xml)
        result = validate_tdc01_xml(xml)
        self.assertTrue(result.valid, f"XSD validation failed: {result.errors}")

    def test_deterministic_repeat_serialization(self):
        doc = self._minimal_document()
        first = serialize_tdc01(doc)
        second = serialize_tdc01(doc)
        self.assertEqual(first, second)

    def test_missing_td_reference_no_fails_validation(self):
        doc = self._minimal_document()
        doc.td_reference_no = ""
        xml = serialize_tdc01(doc)
        result = validate_tdc01_xml(xml)
        self.assertFalse(result.valid)

    def test_invalid_enum_fails_validation(self):
        doc = self._minimal_document()
        doc.sellers_details[0].gender = "X"
        xml = serialize_tdc01(doc)
        result = validate_tdc01_xml(xml)
        self.assertFalse(result.valid)

    def test_invalid_pattern_fails_validation(self):
        doc = self._minimal_document()
        doc.sellers_details[0].id_no = "not-a-13-digit-id"
        xml = serialize_tdc01(doc)
        result = validate_tdc01_xml(xml)
        self.assertFalse(result.valid)


class GoldenFixtureTests(MinimalDocumentMixin, unittest.TestCase):
    def test_golden_fixture_matches_deterministic_output(self):
        doc = self._minimal_document()
        xml = serialize_tdc01(doc)
        fixture_path = os.path.join(os.path.dirname(__file__), "fixtures", "sars_tdc01_golden_minimal.xml")
        with open(fixture_path, "r", encoding="utf-8") as f:
            expected = f.read()
        self.assertEqual(xml, expected)

    def test_golden_fixture_validates(self):
        fixture_path = os.path.join(os.path.dirname(__file__), "fixtures", "sars_tdc01_golden_minimal.xml")
        with open(fixture_path, "r", encoding="utf-8") as f:
            xml = f.read()
        result = validate_tdc01_xml(xml)
        self.assertTrue(result.valid, f"XSD validation failed: {result.errors}")


class TypedBuilderTests(unittest.IsolatedAsyncioTestCase):
    def _minimal_payload(self):
        return {
            "snapshot_at": "2026-09-10T10:00:00+00:00",
            "payload_version": "1.0",
            "ownership_groups": {
                "transfer_matter_sourced": {
                    "purchase_price": 1500000.0,
                    "transaction_date": "2026-09-10",
                    "property_address": "123 Main Street, Testville",
                },
                "golden_record_sourced": [
                    {
                        "transfer_party_id": "11111111-1111-1111-1111-111111111111",
                        "golden_record_id": "00000000-0000-0000-0000-000000000001",
                        "entity_type": "person",
                        "role": "transferor",
                        "display_name": "John Smith",
                        "display_id_number": "7701010001083",
                        "display_email": "john.smith@example.com",
                    },
                    {
                        "transfer_party_id": "22222222-2222-2222-2222-222222222222",
                        "golden_record_id": "00000000-0000-0000-0000-000000000002",
                        "entity_type": "person",
                        "role": "transferee",
                        "display_name": "Jane Doe",
                        "display_id_number": "8202020002084",
                        "display_email": "jane.doe@example.com",
                    },
                ],
                "party_specific_sars": [
                    {
                        "transfer_party_id": "11111111-1111-1111-1111-111111111111",
                        "share_percentage": 50.0,
                    },
                    {
                        "transfer_party_id": "22222222-2222-2222-2222-222222222222",
                        "share_percentage": 50.0,
                    },
                ],
                "property_specific_sars": {
                    "total_fair_value": 1500000.0,
                },
                "calculated_values": {
                    "transfer_duty_payable": 15000.0,
                    "total_payable": 15000.0,
                    "sub_total": 15000.0,
                },
                "declaration_data": [
                    {"declaration_type": "seller", "declaration_date": "2026-09-10"},
                    {"declaration_type": "purchaser", "declaration_date": "2026-09-10"},
                    {"declaration_type": "conveyancer", "declaration_date": "2026-09-10"},
                ],
                "accountable_institution": {
                    "firm_name": "Legitify Conveyancers Inc",
                    "sars_contact_details": {
                        "contact_name": "Conveyancer Contact",
                        "phone": "0115550123",
                        "email": "conveyancer@example.com",
                    },
                },
            },
        }

    async def test_build_minimal_payload_and_validate(self):
        payload = self._minimal_payload()
        golden_records = {
            "00000000-0000-0000-0000-000000000001": {
                "first_name": "John Peter",
                "surname": "Smith",
                "initials": "JP",
                "identity_number": "7701010001083",
                "gender": "male",
                "marital_status": "single",
                "email": "john.smith@example.com",
            },
            "00000000-0000-0000-0000-000000000002": {
                "first_name": "Jane Mary",
                "surname": "Doe",
                "initials": "JM",
                "identity_number": "8202020002084",
                "gender": "female",
                "marital_status": "single",
                "email": "jane.doe@example.com",
            },
        }
        doc = await build_tdc01_document(
            payload,
            transaction_type="Sale",
            td_reference_no="TDE0A1B2C3",
            form_wizard={"normal": True},
            golden_records=golden_records,
        )
        xml = serialize_tdc01(doc)
        result = validate_tdc01_xml(xml)
        self.assertTrue(result.valid, f"XSD validation failed: {result.errors}")

    async def test_builder_requires_td_reference(self):
        payload = self._minimal_payload()
        with self.assertRaises(SarsTdc01BuilderError) as ctx:
            await build_tdc01_document(payload, transaction_type="Sale")
        self.assertIn("TDReferenceNo", str(ctx.exception))

    async def test_builder_unresolved_nature_of_person_for_company(self):
        payload = self._minimal_payload()
        payload["ownership_groups"]["golden_record_sourced"][0]["entity_type"] = "company"
        doc = await build_tdc01_document(
            payload,
            transaction_type="Sale",
            td_reference_no="TDE0A1B2C3",
            form_wizard={"normal": True},
        )
        self.assertEqual(doc.sellers_details[0].nature_of_person, "UNRESOLVED")
        xml = serialize_tdc01(doc)
        result = validate_tdc01_xml(xml)
        self.assertFalse(result.valid)

    async def test_builder_no_sellers_fails(self):
        payload = self._minimal_payload()
        payload["ownership_groups"]["golden_record_sourced"] = []
        with self.assertRaises(SarsTdc01BuilderError) as ctx:
            await build_tdc01_document(
                payload,
                transaction_type="Sale",
                td_reference_no="TDE0A1B2C3",
                form_wizard={"normal": True},
            )
        self.assertIn("No seller party found", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
