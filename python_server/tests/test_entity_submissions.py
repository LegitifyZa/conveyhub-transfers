import os
import sys
import unittest
from dataclasses import FrozenInstanceError, asdict
from unittest.mock import patch
from uuid import UUID

import httpx

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from clients.entities import EntityServiceError
from clients.entity_submissions import (
    CompanySubmission,
    PersonSubmission,
    SubmissionReference,
    TrustSubmission,
    parse_submission_response,
)


TENANT = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
GR = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")


def response(data, status=201):
    return httpx.Response(status, json={"message": "PRIVATE-MESSAGE", "data": data})


def reference(kind):
    data = {"id": str(GR)}
    if kind != "person":
        data.update(entity_type="company", is_trust=kind == "trust", masters_office="cape_town" if kind == "trust" else None)
    return data


class SubmissionRequestTests(unittest.TestCase):
    def test_minimal_person_has_no_product_required_name_or_contact(self):
        payload = PersonSubmission(tenant_id=TENANT, id_number=" 1234567890123 ").to_payload()
        self.assertEqual(payload, {
            "tenant_id": str(TENANT), "id_number": "1234567890123",
            "is_company": False, "is_trust": False, "is_south_african": False,
        })

    def test_optional_person_fields_are_structural_not_product_validation(self):
        payload = PersonSubmission(
            tenant_id=TENANT, id_number="1234567890123", is_south_african=True,
            first_name="", surname=" Draft Name ", email="not-an-email", cellphone="",
            lookup_profile_slug="source-profile",
        ).to_payload()
        self.assertTrue(payload["is_south_african"])
        self.assertEqual(payload["id_number"], "1234567890123")
        self.assertEqual(payload["first_name"], "")
        self.assertEqual(payload["surname"], " Draft Name ")
        self.assertEqual(payload["email"], "not-an-email")
        self.assertEqual(payload["lookup_profile_slug"], "source-profile")

    def test_company_maps_registration_without_inventing_a_jurisdiction_format(self):
        payload = CompanySubmission(tenant_id=TENANT, registration_no=" REG-1 ").to_payload()
        self.assertEqual(payload, {
            "tenant_id": str(TENANT), "id_number": "REG-1", "is_company": True, "is_trust": False,
        })
        self.assertEqual(CompanySubmission(tenant_id=TENANT, registration_no="REG-1", legal_name="").to_payload()["legal_name"], "")

    def test_trust_normalizes_number_and_explicit_office_without_losing_zeros(self):
        for number in ("IT 001841/2023(G)", "it001841/2023g", "001841/2023"):
            with self.subTest(number=number):
                payload = TrustSubmission(
                    tenant_id=TENANT, registration_no=number,
                    masters_office=" CAPE TOWN MASTERS OFFICE ", legal_name="Family Trust",
                ).to_payload()
                self.assertEqual(payload, {
                    "tenant_id": str(TENANT), "id_number": "001841/2023", "is_company": True,
                    "is_trust": True, "masters_office": "cape_town", "legal_name": "Family Trust",
                })

    def test_same_number_different_offices_stays_distinct(self):
        payloads = [TrustSubmission(tenant_id=TENANT, registration_no="1841/2023", masters_office=office).to_payload()
                    for office in ("Cape Town", "Johannesburg")]
        self.assertEqual(payloads[0]["id_number"], payloads[1]["id_number"])
        self.assertNotEqual(payloads[0]["masters_office"], payloads[1]["masters_office"])

    def test_trust_requires_office_instead_of_inferring_it_from_number(self):
        for office in (None, "", " \t ", "MASTERS OFFICE", 5, True, []):
            with self.subTest(office=office), self.assertRaises(ValueError):
                TrustSubmission(tenant_id=TENANT, registration_no="IT1841/2023(G)", masters_office=office).to_payload()

    def test_trust_rejects_empty_normalized_number_and_person_id(self):
        for number in ("IT", "1234567890123", "IT1234567890123"):
            with self.subTest(number=number), self.assertRaises(ValueError):
                TrustSubmission(tenant_id=TENANT, registration_no=number, masters_office="Cape Town").to_payload()

    def test_tenant_uuid_is_validated_not_resolved_from_an_ai(self):
        for tenant in (TENANT, str(TENANT).upper()):
            self.assertEqual(PersonSubmission(tenant_id=tenant, id_number="1").to_payload()["tenant_id"], str(TENANT))
        for tenant in (None, 5, True, "", "PRIVATE-TENANT", [], {}):
            with self.subTest(tenant=tenant), self.assertRaises(ValueError) as caught:
                PersonSubmission(tenant_id=tenant, id_number="1").to_payload()
            self.assertNotIn("PRIVATE-TENANT", str(caught.exception))

    def test_identifier_shape_and_source_length_bound(self):
        factories = (
            lambda value: PersonSubmission(tenant_id=TENANT, id_number=value),
            lambda value: CompanySubmission(tenant_id=TENANT, registration_no=value),
            lambda value: TrustSubmission(tenant_id=TENANT, registration_no=value, masters_office="Cape Town"),
        )
        for factory in factories:
            for value in ("1", "X" * 50):
                self.assertEqual(factory(value).to_payload()["id_number"], value)
            for value in (None, "", " \t ", "X" * 51, 123, True, [], {}):
                with self.subTest(value=value), self.assertRaises(ValueError):
                    factory(value).to_payload()

    def test_optional_fields_and_flags_reject_non_structural_types(self):
        for field in ("first_name", "surname", "email", "cellphone", "lookup_profile_slug"):
            for value in (123, True, [], {}):
                with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                    PersonSubmission(tenant_id=TENANT, id_number="1", **{field: value}).to_payload()
        for value in (None, 0, 1, "true"):
            with self.subTest(flag=value), self.assertRaises(ValueError):
                PersonSubmission(tenant_id=TENANT, id_number="1", is_south_african=value).to_payload()
        for factory in (CompanySubmission, TrustSubmission):
            args = {"masters_office": "Cape Town"} if factory is TrustSubmission else {}
            with self.assertRaises(ValueError):
                factory(tenant_id=TENANT, registration_no="REG-1", legal_name=[], **args).to_payload()

    def test_passport_and_protected_overrides_are_not_adapter_inputs(self):
        for field, value in (
            ("passport_number", "AB123"), ("passport_country", "GB"),
            ("accountable_institution_id", 5), ("user_id", 1), ("entity_type", "company"),
            ("is_company", True), ("is_trust", True), ("force_refresh", True),
        ):
            with self.subTest(field=field), self.assertRaises(TypeError):
                PersonSubmission(tenant_id=TENANT, id_number="1", **{field: value})
        with self.assertRaises(TypeError):
            CompanySubmission(tenant_id=TENANT, registration_no="REG-1", email="ignored@example.invalid")
        with self.assertRaises(TypeError):
            TrustSubmission(tenant_id=TENANT, registration_no="1841/2023", masters_office="Cape Town", lookup_profile_slug="ignored")

    def test_requests_are_immutable_redacted_and_return_fresh_payloads(self):
        request = PersonSubmission(tenant_id=TENANT, id_number="PRIVATE-ID", first_name="PRIVATE-NAME")
        payload = request.to_payload()
        payload["id_number"] = "changed"
        self.assertEqual(request.to_payload()["id_number"], "PRIVATE-ID")
        self.assertNotIn("PRIVATE", repr(request))
        with self.assertRaises(FrozenInstanceError):
            request.id_number = "changed"

    def test_adapters_do_not_construct_clients_query_a_database_or_retry(self):
        requests = (
            (PersonSubmission(tenant_id=TENANT, id_number="1"), "person", {}),
            (CompanySubmission(tenant_id=TENANT, registration_no="REG-1"), "company", {}),
            (TrustSubmission(tenant_id=TENANT, registration_no="1841/2023", masters_office="Cape Town"), "trust", {"expected_masters_office": "Cape Town"}),
        )
        with patch("httpx.AsyncClient") as async_client, patch("httpx.Client") as client, \
                patch("db.query") as query, patch("db.with_transaction") as transaction, \
                patch("clients.entities.asyncio.sleep") as sleep:
            for request, kind, options in requests:
                request.to_payload()
                self.assertEqual(parse_submission_response(response(reference(kind)), kind, **options).golden_record_id, GR)
            for operation in (async_client, client, query, transaction, sleep):
                operation.assert_not_called()


class SubmissionResponseTests(unittest.TestCase):
    def test_person_accepts_the_missing_upstream_discriminator_and_normalizes_uuid(self):
        for extra in ({}, {"entity_type": "person"}, {"is_trust": False}):
            result = parse_submission_response(response({"id": str(GR).upper(), **extra}), "person")
            self.assertEqual(result, SubmissionReference(golden_record_id=GR, entity_type="person"))

    def test_company_and_trust_return_the_expected_logical_reference(self):
        for kind in ("company", "trust"):
            options = {"expected_masters_office": "Cape Town"} if kind == "trust" else {}
            result = parse_submission_response(response(reference(kind)), kind, **options)
            self.assertEqual(result, SubmissionReference(golden_record_id=GR, entity_type=kind))

    def test_response_is_not_canonical_data_authorization_creation_or_verification_proof(self):
        result = parse_submission_response(response({
            "id": str(GR), "tenant_id": "OTHER-CREATOR", "status": "active", "approval_status": "pending",
            "full_name": "PRIVATE-NAME", "profile": {"secret": "PRIVATE-KEY"}, "lookup_errors": ["PRIVATE-ERROR"],
        }), "person")
        self.assertEqual(asdict(result), {"golden_record_id": GR, "entity_type": "person"})
        self.assertNotIn("PRIVATE", repr(result))

    def test_invalid_or_missing_uuid_is_not_a_reference(self):
        for value in (None, "", "PRIVATE-ID", 123, True, [], {}):
            with self.subTest(value=value), self.assertRaises(EntityServiceError) as caught:
                parse_submission_response(response({"id": value}), "person")
            self.assertEqual(caught.exception.category, "invalid_response")
            self.assertNotIn("PRIVATE", str(caught.exception))
        for key in ("golden_record_id", "entity_id"):
            with self.assertRaises(EntityServiceError):
                parse_submission_response(response({key: str(GR)}), "person")

    def test_logical_type_and_strict_trust_markers_are_validated(self):
        cases = (
            ("person", {"entity_type": "company", "is_trust": False}),
            ("person", {"entity_type": None}), ("person", {"is_trust": True}),
            ("person", {"is_trust": 0}), ("company", {}),
            ("company", {"entity_type": "company"}),
            ("company", {"entity_type": "company", "is_trust": True}),
            ("company", {"entity_type": "company", "is_trust": 0}),
            ("trust", {"entity_type": "trust", "is_trust": True}),
            ("trust", {"entity_type": "company", "is_trust": False}),
            ("trust", {"entity_type": "company", "is_trust": 1}),
            ("trust", {"is_trust": True}),
        )
        for kind, fields in cases:
            options = {"expected_masters_office": "Cape Town"} if kind == "trust" else {}
            with self.subTest(kind=kind, fields=fields), self.assertRaises(EntityServiceError) as caught:
                parse_submission_response(response({"id": str(GR), "masters_office": "cape_town", **fields}), kind, **options)
            self.assertEqual(caught.exception.category, "invalid_response")

    def test_trust_response_must_match_the_explicit_office(self):
        for office in (None, "", "Johannesburg", True, [], {}):
            with self.subTest(office=office), self.assertRaises(EntityServiceError) as caught:
                parse_submission_response(response({**reference("trust"), "masters_office": office}), "trust", expected_masters_office="Cape Town")
            self.assertEqual(caught.exception.category, "invalid_response")
        data = {**reference("trust"), "masters_office": "CAPE TOWN MASTERS OFFICE"}
        self.assertEqual(parse_submission_response(response(data), "trust", expected_masters_office="cape_town").entity_type, "trust")

    def test_expected_type_and_office_are_validated_locally(self):
        for kind in (None, "", "PERSON", "partnership", "PRIVATE-TYPE", [], True):
            with self.subTest(kind=kind), self.assertRaises(ValueError) as caught:
                parse_submission_response(response(reference("person")), kind)
            self.assertNotIn("PRIVATE", str(caught.exception))
        for office in (None, "", " ", [], True):
            with self.subTest(office=office), self.assertRaises(ValueError):
                parse_submission_response(response(reference("trust")), "trust", expected_masters_office=office)
        with self.assertRaises(ValueError):
            parse_submission_response(response(reference("company")), "company", expected_masters_office="Cape Town")

    def test_missing_envelopes_and_non_object_data_fail_safely(self):
        for envelope in ({}, {"message": "PRIVATE"}, [], "PRIVATE", None):
            with self.subTest(envelope=envelope), self.assertRaises(EntityServiceError) as caught:
                parse_submission_response(httpx.Response(201, json=envelope), "person")
            self.assertIn(caught.exception.category, {"missing_data_envelope", "malformed_json"})
        for data in (None, [], "PRIVATE", True, 1):
            with self.subTest(data=data), self.assertRaises(EntityServiceError) as caught:
                parse_submission_response(response(data), "person")
            self.assertEqual(caught.exception.category, "invalid_response")

    def test_non_json_is_sanitized(self):
        with self.assertRaises(EntityServiceError) as caught:
            parse_submission_response(httpx.Response(201, content=b"PRIVATE-NON-JSON"), "person")
        self.assertEqual(caught.exception.category, "malformed_json")
        self.assertNotIn("PRIVATE", str(caught.exception))

    def test_only_the_source_confirmed_201_response_is_accepted(self):
        for status in (200, 202, 204):
            with self.subTest(status=status), self.assertRaises(EntityServiceError) as caught:
                parse_submission_response(response(reference("person"), status), "person")
            self.assertEqual(caught.exception.category, "invalid_response")

    def test_http_errors_including_409_never_become_success_or_authorization(self):
        for status in (301, 400, 401, 403, 404, 409, 422, 429, 500, 503):
            with self.subTest(status=status), self.assertRaises(EntityServiceError) as caught:
                parse_submission_response(response({**reference("person"), "name": "PRIVATE"}, status), "person")
            error = caught.exception
            self.assertEqual(error.status_code, status)
            self.assertEqual(error.operation, "submit_person")
            self.assertEqual(error.category, {404: "not_found", 422: "validation_error"}.get(status, "http_error"))
            self.assertNotIn("PRIVATE", str(error))

    def test_validation_errors_keep_only_known_field_names_not_messages_or_records(self):
        upstream = httpx.Response(422, json={
            "message": "PRIVATE-MESSAGE", "data": {"id": str(GR), "full_name": "PRIVATE-NAME"},
            "errors": {"id_number": ["PRIVATE-ID"], "masters_office": ["PRIVATE-OFFICE"], "PRIVATE-FIELD": ["PRIVATE-KEY"], "body": ["PRIVATE-BODY"]},
        })
        with self.assertRaises(EntityServiceError) as caught:
            parse_submission_response(upstream, "trust", expected_masters_office="Cape Town")
        self.assertEqual(caught.exception.error_fields, ("body", "id_number", "masters_office"))
        self.assertNotIn("PRIVATE", repr(vars(caught.exception)))
        self.assertNotIn(str(GR), repr(vars(caught.exception)))
