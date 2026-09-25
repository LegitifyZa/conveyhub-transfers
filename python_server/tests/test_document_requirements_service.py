"""Unit tests for DEEDLY Document Requirements Engine & Document Center Service."""

from datetime import datetime, timezone
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

from services.document_requirements_service import (
    _eval_condition,
    evaluate_matter_requirements,
    request_adhoc_document,
    record_document_upload,
    review_document_requirement,
    mark_generation_satisfied,
    record_document_download,
    get_matter_requirements_summary,
    MatterNotFoundError,
    RequirementNotFoundError,
)


class TestConditionEvaluation(unittest.TestCase):
    def test_direct_equality(self):
        cond = {"classification_category": "transfer"}
        self.assertTrue(_eval_condition(cond, {"classification_category": "transfer"}))
        self.assertFalse(_eval_condition(cond, {"classification_category": "bond"}))

    def test_and_condition(self):
        cond = {
            "and": [
                {"classification_category": "transfer"},
                {"property_type": "sectional_title"}
            ]
        }
        self.assertTrue(_eval_condition(cond, {
            "classification_category": "transfer",
            "property_type": "sectional_title"
        }))
        self.assertFalse(_eval_condition(cond, {
            "classification_category": "transfer",
            "property_type": "freehold"
        }))

    def test_or_condition(self):
        cond = {
            "or": [
                {"entity_type": "company"},
                {"entity_type": "trust"}
            ]
        }
        self.assertTrue(_eval_condition(cond, {"entity_type": "company"}))
        self.assertTrue(_eval_condition(cond, {"entity_type": "trust"}))
        self.assertFalse(_eval_condition(cond, {"entity_type": "person"}))

    def test_operator_in_list(self):
        cond = {
            "party_role": {"op": "in", "value": ["transferor", "transferee"]}
        }
        self.assertTrue(_eval_condition(cond, {"party_role": "transferor"}))
        self.assertTrue(_eval_condition(cond, {"party_role": "transferee"}))
        self.assertFalse(_eval_condition(cond, {"party_role": "bondholder"}))


class TestDocumentRequirementsService(unittest.IsolatedAsyncioTestCase):
    async def test_evaluate_matter_requirements_success(self):
        matter_id = uuid4()
        institution_id = 1
        party_id = uuid4()

        mock_conn = AsyncMock()

        # 1. Matter row
        mock_conn.fetchrow.side_effect = [
            # First fetchrow for matter
            {
                "id": matter_id,
                "matter_type": "transfer",
                "classification_code": "transfer.private_treaty.sectional_title_register",
                "accountable_institution_id": institution_id,
                "classification_category": "transfer",
                "classification_subtype": "private_treaty"
            },
            # Subsequent fetchrows for INSERT
            {"id": uuid4()},
            {"id": uuid4()}
        ]

        # 2. Properties
        properties_mock = [{
            "id": uuid4(),
            "property_type": "sectional_title",
            "sectional_scheme_name": "Sunset Villas",
            "erf_number": "123"
        }]

        # 3. Parties
        parties_mock = [{
            "id": party_id,
            "role": "transferor",
            "entity_type": "person",
            "display_name": "Alice Smith",
            "id_number": "9001015009087"
        }]

        # 4. Rules
        rules_mock = [
            {
                "rule_code": "rule.transfer.poa.standard",
                "document_code": "power_of_attorney_to_transfer",
                "title": "Power of Attorney",
                "target_role_code": "transferor",
                "condition_expression": {"classification_category": "transfer"},
                "requirement_nature": "MANDATORY",
                "priority": 10,
                "doc_name": "Power of Attorney to Pass Transfer",
                "fulfillment_type": "GENERATED",
                "doc_category": "authorities"
            },
            {
                "rule_code": "rule.sectional.levy_clearance",
                "document_code": "body_corporate_levy_clearance",
                "title": "Body Corporate Levy Clearance",
                "target_role_code": None,
                "condition_expression": {"property_type": "sectional_title"},
                "requirement_nature": "MANDATORY",
                "priority": 40,
                "doc_name": "Body Corporate Levy Clearance",
                "fulfillment_type": "COLLECTED",
                "doc_category": "sectional_title"
            }
        ]

        # 5. Existing requirements (none initially)
        existing_mock = []

        # Return list for get_matter_requirements
        final_reqs = [
            {
                "id": uuid4(),
                "matter_id": matter_id,
                "document_code": "power_of_attorney_to_transfer",
                "rule_code": "rule.transfer.poa.standard",
                "origin": "RULE_AUTOMATED",
                "target_party_id": party_id,
                "title": "Power of Attorney to Pass Transfer — Alice Smith",
                "status": "READY_TO_GENERATE",
                "document_name": "Power of Attorney to Pass Transfer",
                "document_category": "authorities",
                "fulfillment_type": "GENERATED",
                "default_output_formats": ["pdf", "docx"],
                "party_name": "Alice Smith",
                "party_role": "transferor"
            }
        ]

        mock_conn.fetch.side_effect = [
            properties_mock,
            parties_mock,
            rules_mock,
            existing_mock,
            final_reqs
        ]

        results = await evaluate_matter_requirements(institution_id, matter_id, conn=mock_conn)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["document_code"], "power_of_attorney_to_transfer")
        self.assertEqual(results[0]["status"], "READY_TO_GENERATE")

    async def test_evaluate_matter_not_found(self):
        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = None

        with self.assertRaises(MatterNotFoundError):
            await evaluate_matter_requirements(1, uuid4(), conn=mock_conn)

    async def test_request_adhoc_document(self):
        matter_id = uuid4()
        institution_id = 1
        user_id = uuid4()

        mock_conn = AsyncMock()
        mock_conn.fetchrow.side_effect = [
            {"id": matter_id},  # Matter exists
            {"code": "fica_proof_of_residence", "name": "Proof of Residence", "fulfillment_type": "COLLECTED"},
            {
                "id": uuid4(),
                "matter_id": matter_id,
                "document_code": "fica_proof_of_residence",
                "origin": "MANUAL_AD_HOC",
                "title": "Additional Proof of Address",
                "status": "AWAITING_UPLOAD",
                "created_at": datetime.now(timezone.utc)
            }
        ]

        res = await request_adhoc_document(
            institution_id, matter_id, "fica_proof_of_residence",
            title="Additional Proof of Address",
            instructions="Please provide utility bill from co-owner",
            created_by_user_id=user_id,
            conn=mock_conn
        )
        self.assertEqual(res["origin"], "MANUAL_AD_HOC")
        self.assertEqual(res["status"], "AWAITING_UPLOAD")

    async def test_review_document_approval(self):
        req_id = uuid4()
        matter_id = uuid4()
        institution_id = 1
        reviewer_id = uuid4()

        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = {"id": req_id, "matter_id": matter_id, "status": "UNDER_REVIEW"}

        res = await review_document_requirement(
            institution_id, req_id, approved=True, reviewer_user_id=reviewer_id, conn=mock_conn
        )
        self.assertEqual(res["status"], "SATISFIED")
        self.assertTrue(res["approved"])

    async def test_review_document_rejection(self):
        req_id = uuid4()
        matter_id = uuid4()
        institution_id = 1
        reviewer_id = uuid4()

        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = {"id": req_id, "matter_id": matter_id, "status": "UNDER_REVIEW"}

        res = await review_document_requirement(
            institution_id, req_id, approved=False, reviewer_user_id=reviewer_id,
            rejection_reason="Document is blurry and older than 3 months",
            conn=mock_conn
        )
        self.assertEqual(res["status"], "REJECTED")
        self.assertFalse(res["approved"])
        self.assertEqual(res["rejection_reason"], "Document is blurry and older than 3 months")

    async def test_mark_generation_satisfied(self):
        req_id = uuid4()
        matter_id = uuid4()
        institution_id = 1
        gen_id = "GEN-2026-9999"

        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = {"id": req_id, "matter_id": matter_id, "status": "READY_TO_GENERATE"}

        res = await mark_generation_satisfied(institution_id, req_id, gen_id, conn=mock_conn)
        self.assertEqual(res["status"], "SATISFIED")
        self.assertEqual(res["generation_id"], gen_id)

    async def test_record_document_upload(self):
        req_id = uuid4()
        matter_id = uuid4()
        institution_id = 1
        doc_id = uuid4()
        user_id = uuid4()

        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = {"id": req_id, "matter_id": matter_id, "status": "AWAITING_UPLOAD"}

        res = await record_document_upload(
            institution_id, req_id, doc_id, uploaded_by_user_id=user_id, conn=mock_conn
        )
        self.assertEqual(res["status"], "UNDER_REVIEW")
        self.assertEqual(res["document_id"], doc_id)

    async def test_record_document_download(self):
        req_id = uuid4()
        matter_id = uuid4()
        institution_id = 1
        user_id = 101

        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = {
            "id": req_id,
            "matter_id": matter_id,
            "document_code": "power_of_attorney_to_transfer",
            "status": "SATISFIED",
            "satisfied_by_document_id": None,
            "satisfied_by_generation_id": "GEN-1234",
            "document_name": "Power of Attorney to Pass Transfer",
            "file_path": "/storage/poa.pdf",
            "file_type": "application/pdf"
        }

        res = await record_document_download(
            institution_id, req_id, user_id=user_id, conn=mock_conn
        )
        self.assertEqual(res["document_name"], "Power of Attorney to Pass Transfer")
        self.assertEqual(res["generation_id"], "GEN-1234")

    async def test_record_document_download_not_found(self):
        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = None

        with self.assertRaises(RequirementNotFoundError):
            await record_document_download(1, uuid4(), user_id=101, conn=mock_conn)

    @patch("services.document_requirements_service.get_matter_requirements")
    async def test_get_matter_requirements_summary(self, mock_get):
        matter_id = uuid4()
        institution_id = 1
        mock_get.return_value = [
            {"status": "SATISFIED", "document_category": "fica"},
            {"status": "SATISFIED", "document_category": "fica"},
            {"status": "AWAITING_UPLOAD", "document_category": "municipal_rates"},
            {"status": "READY_TO_GENERATE", "document_category": "conveyancing_deeds"},
        ]

        summary = await get_matter_requirements_summary(institution_id, matter_id)
        self.assertEqual(summary["total_required"], 4)
        self.assertEqual(summary["satisfied"], 2)
        self.assertEqual(summary["pending_upload"], 1)
        self.assertEqual(summary["ready_to_generate"], 1)
        self.assertEqual(summary["progress_percent"], 50)
        self.assertTrue(summary["bundles"]["fica_complete"])
        self.assertFalse(summary["bundles"]["rates_clearance_complete"])
        self.assertFalse(summary["bundles"]["all_satisfied"])



if __name__ == "__main__":
    unittest.main()
