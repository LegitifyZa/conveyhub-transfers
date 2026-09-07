"""V1.17 XSD validation tests for the SARS TDC01 XML boundary.

These tests exercise the real SARS-supplied ``SARSTransferDutyReturnV1.17.xsd``
package (and its imports) from ``python_server/resources/sars/``. They do not
require a database.
"""

import os
import sys
import unittest
import unittest.mock

_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_python_server = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _project_root)
sys.path.insert(0, _python_server)

from services.sars_xml_validator import validate, validate_payload


VALID_TDC01 = """<?xml version="1.0" encoding="utf-8"?>
<TransferDutyReturn xmlns="http://www.sars.gov.za/enterpriseMessagingModel/TransferDutyReturn/xml/schemas/version/1.13">
  <TDReferenceNo>12345678</TDReferenceNo>
  <TransactionType>Sale</TransactionType>
  <FormWizard />
</TransferDutyReturn>
"""

INVALID_ENUM = """<?xml version="1.0" encoding="utf-8"?>
<TransferDutyReturn xmlns="http://www.sars.gov.za/enterpriseMessagingModel/TransferDutyReturn/xml/schemas/version/1.13">
  <TDReferenceNo>12345678</TDReferenceNo>
  <TransactionType>Sale</TransactionType>
  <FormWizard>
    <ExemptInd>X</ExemptInd>
  </FormWizard>
</TransferDutyReturn>
"""

INVALID_PATTERN = """<?xml version="1.0" encoding="utf-8"?>
<TransferDutyReturn xmlns="http://www.sars.gov.za/enterpriseMessagingModel/TransferDutyReturn/xml/schemas/version/1.13">
  <TDReferenceNo>1234567</TDReferenceNo>
  <TransactionType>Sale</TransactionType>
  <FormWizard />
</TransferDutyReturn>
"""


class SarsXmlV117Tests(unittest.TestCase):
    def test_authoritative_schema_loads(self):
        result = validate(VALID_TDC01)
        self.assertTrue(result.schema_loaded)
        self.assertTrue(result.valid)
        self.assertEqual(result.errors, [])
        self.assertIn("SARSTransferDutyReturnV1.17.xsd", result.schema_path or "")

    def test_known_valid_minimal_document(self):
        result = validate(VALID_TDC01)
        self.assertTrue(result.valid)
        self.assertTrue(result.schema_loaded)
        self.assertEqual(result.errors, [])

    def test_structurally_invalid_xml_is_rejected(self):
        result = validate("<root/>")
        self.assertFalse(result.valid)
        self.assertTrue(result.schema_loaded)
        self.assertTrue(any("not an element" in e.lower() or "root" in e.lower() for e in result.errors))

    def test_invalid_enum_rejected(self):
        result = validate(INVALID_ENUM)
        self.assertFalse(result.valid)
        self.assertTrue(result.schema_loaded)
        self.assertTrue(any("Y" in e and "N" in e for e in result.errors))

    def test_invalid_pattern_rejected(self):
        result = validate(INVALID_PATTERN)
        self.assertFalse(result.valid)
        self.assertTrue(result.schema_loaded)
        self.assertTrue(any("pattern" in e.lower() for e in result.errors))

    def test_missing_configured_schema_fails_closed(self):
        with unittest.mock.patch.dict(
            os.environ,
            {"SARS_TDC01_XSD_PATH": "C:\\path\\does\\not\\exist\\SARSTransferDutyReturnV1.17.xsd"},
            clear=False,
        ):
            result = validate(VALID_TDC01)
        self.assertFalse(result.valid)
        self.assertFalse(result.schema_loaded)
        self.assertIn("Configured XSD file not found", result.errors[0])

    def test_errors_returned_in_controlled_result(self):
        result = validate(INVALID_ENUM)
        self.assertIsInstance(result.errors, list)
        self.assertGreater(len(result.errors), 0)
        for error in result.errors:
            self.assertIsInstance(error, str)

    def test_serializer_payload_mismatch_reported(self):
        """Our ad-hoc serializer payload is not yet aligned with the V1.17 schema.

        This test proves the validator reports those mismatches in the controlled
        result rather than raising or hiding them. No SARS semantics are guessed
        to make the document pass.
        """
        payload = {
            "payload_version": "1.0",
            "snapshot_at": "2026-01-01T00:00:00+00:00",
            "ownership_groups": {
                "transfer_matter_sourced": {"purchase_price": 1500000},
                "calculated_values": {"transfer_duty_payable": 12000},
            },
        }
        result = validate_payload(payload)
        self.assertTrue(result.schema_loaded)
        self.assertFalse(result.valid)
        self.assertGreater(len(result.errors), 0)
        for error in result.errors:
            self.assertIsInstance(error, str)
