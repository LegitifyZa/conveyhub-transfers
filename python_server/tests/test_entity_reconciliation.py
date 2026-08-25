import os
import sys
import unittest
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from clients.entities import EntitiesClient, EntityServiceError
from services.entity_reconciliation import (
    EntityReconciliationError,
    EntityReconciliationService,
    PersonSearch,
    ReconciliationStatus,
)


class PersonSearchValidationTests(unittest.TestCase):
    def test_valid_id_number(self):
        s = PersonSearch(id_number="9001010001081")
        self.assertEqual(s.id_number, "9001010001081")
        self.assertEqual(s.to_search_payload(), {"entity_type": "person", "id_number": "9001010001081"})

    def test_valid_passport(self):
        s = PersonSearch(passport_number="A1234567", passport_country="ZA")
        self.assertEqual(
            s.to_search_payload(),
            {"entity_type": "person", "passport_number": "A1234567", "passport_country": "ZA"},
        )

    def test_rejects_both_identity_paths(self):
        with self.assertRaises(ValueError):
            PersonSearch(
                id_number="9001010001081",
                passport_number="A1234567",
                passport_country="ZA",
            )

    def test_rejects_neither_identity_path(self):
        with self.assertRaises(ValueError):
            PersonSearch()

    def test_rejects_passport_without_country(self):
        with self.assertRaises(ValueError):
            PersonSearch(passport_number="A1234567")


class EntityReconciliationServiceTests(unittest.IsolatedAsyncioTestCase):
    def _service(self, client=None):
        if client is None:
            client = AsyncMock(spec=EntitiesClient)
        return EntityReconciliationService(client)

    async def test_id_number_search_calls_entities_once(self):
        client = AsyncMock(spec=EntitiesClient)
        client.search_entities = AsyncMock(return_value={"results": [{"id": "ent-1"}]})
        client.get_entity = AsyncMock(return_value={"id": "ent-1", "entity_type": "person"})
        client.submit_person = AsyncMock()

        service = self._service(client)
        result = await service.reconcile_person(PersonSearch(id_number="9001010001081"))

        client.search_entities.assert_awaited_once_with(
            {"entity_type": "person", "id_number": "9001010001081"}
        )
        client.get_entity.assert_awaited_once_with("ent-1", "person")
        client.submit_person.assert_not_awaited()
        self.assertEqual(result.status, ReconciliationStatus.MATCHED)
        self.assertEqual(result.entity, {"id": "ent-1", "entity_type": "person"})
        self.assertEqual(result.candidate_count, 1)

    async def test_passport_search_matches(self):
        client = AsyncMock(spec=EntitiesClient)
        client.search_entities = AsyncMock(return_value={"results": [{"id": "ent-2"}]})
        client.get_entity = AsyncMock(return_value={"id": "ent-2", "entity_type": "person"})
        client.submit_person = AsyncMock()

        service = self._service(client)
        result = await service.reconcile_person(
            PersonSearch(passport_number="A1234567", passport_country="ZA")
        )

        client.search_entities.assert_awaited_once_with(
            {
                "entity_type": "person",
                "passport_number": "A1234567",
                "passport_country": "ZA",
            }
        )
        self.assertEqual(result.status, ReconciliationStatus.MATCHED)
        client.submit_person.assert_not_awaited()

    async def test_zero_matches_returns_not_found(self):
        client = AsyncMock(spec=EntitiesClient)
        client.search_entities = AsyncMock(return_value={"results": []})
        client.get_entity = AsyncMock()
        client.submit_person = AsyncMock()

        service = self._service(client)
        result = await service.reconcile_person(PersonSearch(id_number="9001010001081"))

        self.assertEqual(result.status, ReconciliationStatus.NOT_FOUND)
        self.assertIsNone(result.entity)
        client.get_entity.assert_not_awaited()
        client.submit_person.assert_not_awaited()

    async def test_multiple_matches_returns_ambiguous(self):
        client = AsyncMock(spec=EntitiesClient)
        client.search_entities = AsyncMock(
            return_value={"results": [{"id": "ent-1"}, {"id": "ent-2"}]}
        )
        client.get_entity = AsyncMock()
        client.submit_person = AsyncMock()

        service = self._service(client)
        result = await service.reconcile_person(PersonSearch(id_number="9001010001081"))

        self.assertEqual(result.status, ReconciliationStatus.AMBIGUOUS)
        self.assertIsNone(result.entity)
        self.assertEqual(result.candidate_count, 2)
        client.get_entity.assert_not_awaited()
        client.submit_person.assert_not_awaited()

    async def test_malformed_search_response_raises_safe(self):
        client = AsyncMock(spec=EntitiesClient)
        client.search_entities = AsyncMock(return_value={"results": "not a list"})

        service = self._service(client)
        with self.assertRaises(EntityReconciliationError) as ctx:
            await service.reconcile_person(PersonSearch(id_number="9001010001081"))

        self.assertIn("did not contain a result list", str(ctx.exception))

    async def test_search_result_without_id_raises_safe(self):
        client = AsyncMock(spec=EntitiesClient)
        client.search_entities = AsyncMock(return_value={"results": [{"name": "Dean"}]})

        service = self._service(client)
        with self.assertRaises(EntityReconciliationError) as ctx:
            await service.reconcile_person(PersonSearch(id_number="9001010001081"))

        self.assertIn("did not include an entity id", str(ctx.exception))

    async def test_non_2xx_response_raises_sanitised(self):
        client = AsyncMock(spec=EntitiesClient)
        pii = {"id_number": "9001010001081", "email": "user@example.com", "name": "Dean"}
        client.search_entities = AsyncMock(
            side_effect=EntityServiceError(
                "Entity service search_entities failed with status 500",
                operation="search_entities",
                status_code=500,
                response_body=pii,
            )
        )

        service = self._service(client)
        with self.assertRaises(EntityServiceError) as ctx:
            await service.reconcile_person(PersonSearch(id_number="9001010001081"))

        text = str(ctx.exception)
        self.assertIn("search_entities", text)
        self.assertIn("500", text)
        self.assertNotIn("9001010001081", text)
        self.assertNotIn("user@example.com", text)
        self.assertNotIn("Dean", text)

    async def test_company_reconciliation_not_supported(self):
        client = AsyncMock(spec=EntitiesClient)
        client.search_entities = AsyncMock()
        client.get_entity = AsyncMock()
        client.submit_person = AsyncMock()

        service = self._service(client)
        with self.assertRaises(EntityReconciliationError) as ctx:
            await service.reconcile_company()

        self.assertIn("Company/trust", str(ctx.exception))
        client.search_entities.assert_not_awaited()
        client.get_entity.assert_not_awaited()
        client.submit_person.assert_not_awaited()

    async def test_reconcile_person_never_calls_submit(self):
        client = AsyncMock(spec=EntitiesClient)
        client.search_entities = AsyncMock(return_value={"results": [{"id": "ent-1"}]})
        client.get_entity = AsyncMock(return_value={"id": "ent-1", "entity_type": "person"})
        client.submit_person = AsyncMock()

        service = self._service(client)
        await service.reconcile_person(PersonSearch(id_number="9001010001081"))

        client.submit_person.assert_not_awaited()

    def test_service_key_not_in_client_repr(self):
        with patch("clients.entities.httpx.AsyncClient") as mock_client_class:
            from config import Settings

            settings = Settings(
                app_name="test",
                app_version="1.0.0",
                port=3000,
                database_url=None,
                db_host="localhost",
                db_port=5432,
                db_name="test",
                db_user="test",
                db_password="test",
                db_min_connections=2,
                db_max_connections=10,
                db_schema="transfers",
                db_ssl=False,
                node_env="development",
                secret_key="super-secret-key-do-not-leak",
                entities_service_url="http://entities:8003",
                redis_url="redis://localhost:6379/0",
                audit_database_url=None,
            )
            client = EntitiesClient(settings)
            text = repr(client._client)
            self.assertNotIn("super-secret-key-do-not-leak", text)


if __name__ == "__main__":
    unittest.main()
