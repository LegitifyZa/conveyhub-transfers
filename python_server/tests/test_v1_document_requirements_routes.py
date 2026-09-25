"""Route tests for FastAPI v1 document requirements endpoints."""

import unittest
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from fastapi.testclient import TestClient

from auth.current_user import CurrentUser
from auth.dependencies import require_jwt
from main import app


def _mock_user(institution_id: int = 1, abilities: list = None) -> CurrentUser:
    return CurrentUser(
        user_id=101,
        golden_record_id=uuid4(),
        abilities=abilities or ["transfers:read", "transfers:write"],
        accountable_institution_id=institution_id,
        user_roles_id=2,  # Staff role
        tenant_id=uuid4(),
    )


class TestDocumentRequirementsRoutes(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.matter_id = uuid4()
        self.institution_id = 1
        self.user = _mock_user(institution_id=self.institution_id)
        app.dependency_overrides[require_jwt] = lambda: self.user

    def tearDown(self):
        app.dependency_overrides.clear()

    @patch("routers.v1.document_requirements.get_matter_requirements_summary")
    def test_get_requirements_success(self, mock_summary):
        mock_summary.return_value = {
            "matter_id": self.matter_id,
            "total_required": 3,
            "satisfied": 1,
            "progress_percent": 33,
            "bundles": {"fica_complete": False, "rates_clearance_complete": False, "all_satisfied": False},
            "requirements": []
        }

        resp = self.client.get(f"/api/v1/matters/{self.matter_id}/document-requirements")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()["data"]
        self.assertEqual(data["total_required"], 3)
        self.assertEqual(data["progress_percent"], 33)

    @patch("routers.v1.document_requirements.get_matter_requirements_summary")
    @patch("routers.v1.document_requirements.evaluate_matter_requirements")
    def test_evaluate_requirements_success(self, mock_eval, mock_summary):
        mock_eval.return_value = []
        mock_summary.return_value = {
            "matter_id": self.matter_id,
            "total_required": 5,
            "satisfied": 0,
            "progress_percent": 0,
            "bundles": {"fica_complete": False, "rates_clearance_complete": False, "all_satisfied": False},
            "requirements": []
        }

        resp = self.client.post(f"/api/v1/matters/{self.matter_id}/document-requirements/evaluate")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["message"], "Requirements evaluated successfully")

    @patch("routers.v1.document_requirements.request_adhoc_document")
    def test_add_adhoc_requirement_success(self, mock_adhoc):
        mock_adhoc.return_value = {
            "id": str(uuid4()),
            "matter_id": str(self.matter_id),
            "document_code": "compliance_certificate_gas",
            "title": "Gas Certificate for Outdoor Braai",
            "status": "AWAITING_UPLOAD"
        }

        payload = {
            "document_code": "compliance_certificate_gas",
            "title": "Gas Certificate for Outdoor Braai",
            "instructions": "Certificate must cover outdoor installation"
        }
        resp = self.client.post(
            f"/api/v1/matters/{self.matter_id}/document-requirements/adhoc",
            json=payload
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["data"]["document_code"], "compliance_certificate_gas")

    @patch("routers.v1.document_requirements.review_document_requirement")
    def test_review_requirement_approval(self, mock_review):
        req_id = uuid4()
        mock_review.return_value = {
            "requirement_id": str(req_id),
            "status": "SATISFIED",
            "approved": True
        }

        resp = self.client.post(
            f"/api/v1/matters/{self.matter_id}/document-requirements/{req_id}/review",
            json={"approved": True}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["data"]["status"], "SATISFIED")

    @patch("routers.v1.document_requirements.mark_generation_satisfied")
    def test_satisfy_generation(self, mock_satisfy):
        req_id = uuid4()
        gen_id = "GEN-2026-12345"
        mock_satisfy.return_value = {
            "requirement_id": str(req_id),
            "status": "SATISFIED",
            "generation_id": gen_id
        }

        resp = self.client.post(
            f"/api/v1/matters/{self.matter_id}/document-requirements/{req_id}/satisfy-generation",
            json={"generation_id": gen_id}
        )
        self.assertEqual(resp.status_code, 200)
    @patch("routers.v1.document_requirements.record_document_upload")
    def test_record_upload(self, mock_upload):
        req_id = uuid4()
        doc_id = uuid4()
        mock_upload.return_value = {
            "requirement_id": str(req_id),
            "status": "UNDER_REVIEW",
            "satisfied_by_document_id": str(doc_id)
        }

        resp = self.client.post(
            f"/api/v1/matters/{self.matter_id}/document-requirements/{req_id}/upload",
            json={"transfer_document_id": str(doc_id)}
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["data"]["status"], "UNDER_REVIEW")

    @patch("routers.v1.document_requirements.record_document_download")
    def test_download_requirement_document(self, mock_download):
        req_id = uuid4()
        mock_download.return_value = {
            "requirement_id": str(req_id),
            "file_path": "/storage/documents/poa.pdf",
            "file_type": "application/pdf",
            "document_name": "Power of Attorney to Pass Transfer"
        }

        resp = self.client.get(
            f"/api/v1/matters/{self.matter_id}/document-requirements/{req_id}/download"
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["data"]["file_path"], "/storage/documents/poa.pdf")


if __name__ == "__main__":
    unittest.main()
