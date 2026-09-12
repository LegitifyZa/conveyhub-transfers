"""Execute selected landed upstream bodies, SQLite queries, and PostgreSQL compilation.

Synthetic tables omit production relationships; this is not deployed PostgreSQL,
JWT middleware, provider, or migration integration. No upstream module is imported.
"""

import ast
import copy
import json
import os
import re
import sys
import types
from datetime import date, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Literal
from unittest.mock import AsyncMock, Mock
from uuid import UUID, uuid4

import pytest

SOURCE_ROOT = os.environ.get("ENTITIES_SOURCE_ROOT")
if not SOURCE_ROOT:
    pytest.skip("Set ENTITIES_SOURCE_ROOT to the landed entities repository to execute this contract", allow_module_level=True)
SOURCE_ROOT = Path(SOURCE_ROOT)
if not (SOURCE_ROOT / "services/entities/src/domain/services/entity_service.py").is_file():
    pytest.fail("ENTITIES_SOURCE_ROOT does not contain the expected entities service source", pytrace=False)

pytest.importorskip("sqlalchemy", reason="Real SQLAlchemy is required; no synthetic SQL implementation is used")
pytest.importorskip("pytest_asyncio", reason="pytest-asyncio is required for executable upstream contracts")

import httpx
from fastapi import Depends, Header
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer
from pydantic import BaseModel, Field, ValidationError, model_validator
from sqlalchemy import Column, DateTime, MetaData, String, Table, Uuid, create_engine, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session, registry

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from clients.entities import EntitiesClient
from clients.entity_submissions import CompanySubmission, PersonSubmission, TrustSubmission, parse_submission_response
from routers.v1.golden_records import search_golden_records
from services import golden_record_search as deedly_search
from services.entity_reconciliation import EntityReconciliationError
from services.golden_record_search import GoldenRecordSearchService, SearchStatus

pytestmark = pytest.mark.asyncio
ENTITY_SERVICE = "services/entities/src/domain/services/entity_service.py"
REPOSITORIES = "services/entities/src/infrastructure/persistence/repositories.py"
ROUTES = "services/entities/src/api/v1/routes.py"
SHARED = "shared/src/legitify_shared/"
CREATOR = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
OTHER_CREATOR = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
AI = 5


def _node(path, name):
    tree = ast.parse((SOURCE_ROOT / path).read_text(encoding="utf-8-sig"), filename=str(SOURCE_ROOT / path))
    for part in name.split("."):
        matches = [node for node in tree.body if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == part]
        assert len(matches) == 1, f"Upstream contract body missing or ambiguous: {path}:{name}"
        tree = matches[0]
    return copy.deepcopy(tree)


def _load(namespace, path, name, methods=None, remove_decorators=False):
    node = _node(path, name)
    if methods is not None:
        node.body = [_node(path, f"{name}.{method}") for method in methods]
        node.bases = []
        node.keywords = []
    if remove_decorators:
        node.decorator_list = []
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), node], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), str(SOURCE_ROOT / path), "exec"), namespace)
    return namespace[node.name]


def _serializer_attributes(method, variable):
    return {
        node.attr
        for node in ast.walk(_node(ENTITY_SERVICE, f"EntityService.{method}"))
        if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == variable
    }


class _SessionAdapter:
    def __init__(self, session):
        self.session = session
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return self.session.execute(statement)


class _Harness:
    def __init__(self):
        self.mapper = registry(metadata=MetaData())
        self.models = {}
        for name, fields in {
            "Person": ["full_name", "national_id", "passport_no", "email"],
            "Company": ["legal_name", "registration_no", "company_type", "masters_office"],
        }.items():
            model = type(name, (), {})
            table = Table(
                "persons" if name == "Person" else "companies", self.mapper.metadata,
                Column("id", Uuid, primary_key=True), Column("tenant_id", Uuid),
                Column("created_at", DateTime), Column("updated_at", DateTime), *[Column(field, String) for field in fields],
            )
            self.mapper.map_imperatively(model, table)
            self.models[name] = model
        self.engine = create_engine("sqlite+pysqlite:///:memory:")
        self.mapper.metadata.create_all(self.engine)
        self.session = Session(self.engine, expire_on_commit=False)
        self.adapter = _SessionAdapter(self.session)
        self.rows = []
        mod = types.ModuleType("landed_entities_contract")
        sys.modules["landed_entities_contract"] = mod
        self.ns = mod.__dict__
        self.ns.update({
            "__name__": "landed_entities_contract", "Any": Any, "UUID": UUID,
            "Literal": Literal, "BaseModel": BaseModel, "Field": Field,
            "JSONResponse": JSONResponse, "Depends": Depends, "Header": Header,
            "date": date, "select": select, **self.models,
            "_optional_bearer": HTTPBearer(auto_error=False),
        })
        for name in ["AppException", "ValidationException", "ForbiddenException", "UnauthorizedException"]:
            _load(self.ns, SHARED + "exceptions.py", name)
        _load(self.ns, SHARED + "response.py", "build_response")
        _load(self.ns, SHARED + "auth/dependencies.py", "CurrentUser")
        _load(self.ns, SHARED + "auth/dependencies.py", "require_jwt_or_service_key")
        _load(self.ns, "services/entities/src/api/v1/schemas.py", "SearchEntitiesRequest")
        _load(self.ns, "services/entities/src/domain/services/data_mapper.py", "normalize_date_or_none")
        methods = ["search_entities", "get_entity", "_company_to_dict", "_person_to_dict", "_apply_corrections", "_get_photo_url", "_get_source_tag"]
        service_class = _load(self.ns, ENTITY_SERVICE, "EntityService", methods)
        self.service = service_class()
        for name in ["Person", "Company"]:
            repo_class = _load(self.ns, REPOSITORIES, f"{name}Repository", ["search"])
            repo = repo_class()
            repo._session = self.adapter
            repo.get_by_id = AsyncMock(side_effect=lambda entity_id, model=self.models[name]: self.session.get(model, entity_id))
            setattr(self.service, f"_{name.lower()}_repo", repo)
        self.service._provider_repo = SimpleNamespace(get_by_name=AsyncMock(side_effect=AssertionError("No provider metadata calls expected")))
        self.service._dispute_repo = SimpleNamespace(get_approved_for_entity=AsyncMock(return_value=[]))
        self.ns["_get_session"] = lambda: None
        self.ns["_get_entity_service"] = lambda request, session: self.service
        _load(self.ns, ROUTES, "_caller_tenant_uuid")
        _load(self.ns, ROUTES, "search_entities", remove_decorators=True)
        self.request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(settings=SimpleNamespace(secret_key="inert-contract-key"))))

    def add(self, kind="Person", **values):
        model = self.models[kind]
        row = model()
        method, variable = ("_person_to_dict", "person") if kind == "Person" else ("_company_to_dict", "company")
        for field in _serializer_attributes(method, variable):
            setattr(row, field, None)
        defaults = dict(id=uuid4(), tenant_id=CREATOR, profile={}, version=1, status="active", created_at=datetime(2026, 1, 1), updated_at=datetime(2026, 1, 1))
        if kind == "Person":
            defaults["photo_s3_key"] = None
        defaults.update(values)
        for field, value in defaults.items():
            setattr(row, field, value)
        self.session.add(row)
        self.session.flush()
        self.rows.append(row)
        return row

    async def route(self, caller=None, **payload):
        body = self.ns["SearchEntitiesRequest"](**payload)
        return await self.ns["search_entities"](body, self.request, caller=caller, session=self.adapter)

    def caller(self, tenant=CREATOR, abilities=None):
        return self.ns["CurrentUser"]({"user_id": 1, "tenant_id": str(tenant) if tenant else None, "abilities": ["entities:read"] if abilities is None else abilities})

    def sql(self, index=-1):
        return str(self.adapter.statements[index].compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))

    def close(self):
        self.session.close()
        self.engine.dispose()
        self.mapper.dispose()


@pytest.fixture
def landed():
    harness = _Harness()
    try:
        yield harness
    finally:
        harness.close()


class _Gateway:
    def __init__(self, landed, linkages):
        self.landed = landed
        self.linkages = linkages
        self.requests = []
        self.responses = []
        self.authorized = set()
        settings = SimpleNamespace(legitify_api_base_url="https://landed-contract.invalid", secret_key="inert-contract-key")
        self.client = EntitiesClient(settings, transport=httpx.MockTransport(self.handle))

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.client.close()

    async def handle(self, request):
        self.requests.append(request)
        assert request.headers["X-Service-Key"] == "inert-contract-key"
        assert "X-Accountable-Institution-Id" not in request.headers
        path = request.url.path
        if path == "/api/v1/entities/search":
            assert request.method == "POST"
            payload = json.loads(request.content)
            assert "tenant_id" not in payload
            caller = await self.landed.ns["require_jwt_or_service_key"](self.landed.request, x_service_key=request.headers["X-Service-Key"], credentials=None)
            response = await self.landed.route(caller=caller, **payload)
            self.responses.append(json.loads(response.body))
            return httpx.Response(response.status_code, content=response.body)
        assert request.method == "GET"
        entity_id = path.rsplit("/", 1)[-1]
        if path.startswith("/api/v1/users/clients/s2s/by-golden-record/"):
            ai = int(request.url.params["accountable_institution_id"])
            if (entity_id, ai) not in self.linkages:
                return httpx.Response(404, json={"message": "Not found", "data": []})
            self.authorized.add(entity_id)
            return httpx.Response(200, json={"message": "Client", "data": {
                "id": 701, "golden_record_id": entity_id, "accountable_institution_id": ai,
            }})
        assert path.startswith("/api/v1/entities/")
        assert entity_id in self.authorized, "Canonical GET must follow a successful AI linkage"
        data = await self.landed.service.get_entity(UUID(entity_id), request.url.params["entity_type"])
        response = self.landed.ns["build_response"]("Entity", data=data, status_code=200 if data else 404)
        return httpx.Response(response.status_code, content=response.body)


@pytest.mark.parametrize("tenant", [None, CREATOR])
async def test_global_and_explicit_creator_scope_execute_real_repository(landed, tenant):
    own = landed.add(full_name="Smith", tenant_id=CREATOR)
    other = landed.add(full_name="Smith", tenant_id=OTHER_CREATOR)
    for kind in ["Person", "Company"]:
        if kind == "Company":
            own = landed.add(kind, legal_name="Smith", tenant_id=CREATOR)
            other = landed.add(kind, legal_name="Smith", tenant_id=OTHER_CREATOR)
        repo = getattr(landed.service, f"_{kind.lower()}_repo")
        rows = await repo.search(tenant, query="Smith")
        assert {row.id for row in rows} == ({own.id, other.id} if tenant is None else {own.id})
        where = landed.sql().split("WHERE", 1)[1]
        assert ("tenant_id =" in where) is (tenant is not None)


@pytest.mark.parametrize("query", [None, "", "   ", "\t\n"])
async def test_global_blank_guard_precedes_any_sql(landed, query):
    with pytest.raises(landed.ns["ValidationException"], match="query is required") as exc:
        await landed.route(query=query)
    assert exc.value.status_code == 422
    assert landed.adapter.statements == []


async def test_scoped_blank_and_unescaped_global_wildcards(landed):
    person = landed.add(full_name="Smith")
    response = await landed.route(tenant_id=CREATOR, query=None, entity_type="person")
    assert json.loads(response.body)["data"][0]["id"] == str(person.id)
    for query in ["%", "_", "Smi%", "Sm_th"]:
        response = await landed.route(query=query, entity_type="person")
        assert json.loads(response.body)["data"][0]["id"] == str(person.id)
        compiled = landed.adapter.statements[-1].compile(dialect=postgresql.dialect())
        assert f"%{query}%" in compiled.params.values()
    response = await landed.route(query=" Smith ", entity_type="person")
    assert json.loads(response.body)["data"] == []


@pytest.mark.parametrize("caller_tenant,body_tenant,expected", [(CREATOR, None, CREATOR), (CREATOR, OTHER_CREATOR, OTHER_CREATOR), (None, OTHER_CREATOR, OTHER_CREATOR)])
async def test_real_route_jwt_scope_and_explicit_override(landed, caller_tenant, body_tenant, expected):
    landed.add(full_name="Smith", tenant_id=CREATOR)
    landed.add(full_name="Smith", tenant_id=OTHER_CREATOR)
    response = await landed.route(caller=landed.caller(caller_tenant), tenant_id=body_tenant, query="Smith", entity_type="person")
    assert {row["tenant_id"] for row in json.loads(response.body)["data"]} == {str(expected)}


@pytest.mark.parametrize("tenant", [None, "not-a-uuid"])
async def test_real_route_rejects_jwt_without_usable_tenant(landed, tenant):
    with pytest.raises(landed.ns["ValidationException"], match="tenant_id is required"):
        await landed.route(caller=landed.caller(tenant), query="Smith")
    assert landed.adapter.statements == []


async def test_real_route_rejects_missing_read_ability(landed):
    with pytest.raises(landed.ns["ForbiddenException"]) as exc:
        await landed.route(caller=landed.caller(abilities=[]), query="Smith")
    assert exc.value.status_code == 403
    assert landed.adapter.statements == []


@pytest.mark.parametrize("payload", [{"entity_type": " Trust "}, {"entity_type": "partnership"}, {"limit": 0}, {"limit": 201}, {"offset": -1}])
async def test_actual_request_schema_rejects_noncontract_inputs(landed, payload):
    with pytest.raises(ValidationError):
        landed.ns["SearchEntitiesRequest"](**payload)


@pytest.mark.parametrize("kind,is_company,expected", [("person", True, "person"), ("company", False, "company"), ("trust", False, "trust"), (None, True, "both_companies"), (None, False, "person")])
async def test_real_service_discriminator_precedence_and_legacy_boolean(landed, kind, is_company, expected):
    person = landed.add(full_name="Smith")
    company = landed.add("Company", legal_name="Smith", company_type="Private")
    trust = landed.add("Company", legal_name="Smith", company_type="Trust")
    data = await landed.service.search_entities(None, "Smith", is_company=is_company, entity_type=kind)
    ids = {"person": {person.id}, "company": {company.id}, "trust": {trust.id}, "both_companies": {company.id, trust.id}}
    assert {UUID(row["id"]) for row in data} == ids[expected]
    assert len(landed.adapter.statements) == 1


@pytest.mark.parametrize("kind,predicate", [("trust", "companies.company_type = 'Trust'"), ("company", "companies.company_type IS DISTINCT FROM 'Trust'")])
async def test_real_typed_predicate_precedes_sql_pagination(landed, kind, predicate):
    rows = []
    for index, tag in enumerate(["Trust", "Private", "Trust", None, "Trust", "Private"]):
        rows.append(landed.add("Company", legal_name="Smith", company_type=tag, created_at=datetime(2026, 1, 1) + timedelta(days=index)))
    data = await landed.service.search_entities(None, "Smith", entity_type=kind, limit=1, offset=1)
    matching = [row for row in reversed(rows) if (row.company_type == "Trust") == (kind == "trust")]
    assert [row["id"] for row in data] == [str(matching[1].id)]
    sql = landed.sql()
    assert sql.index("WHERE") < sql.index(predicate) < sql.index("ORDER BY") < sql.index("LIMIT 1") < sql.index("OFFSET 1")


@pytest.mark.parametrize("kind", ["Person", "Company"])
async def test_current_upstream_order_has_no_unique_tiebreaker(landed, kind):
    repo = getattr(landed.service, f"_{kind.lower()}_repo")
    await repo.search(None, "Smith", limit=2, offset=2)
    table = "persons" if kind == "Person" else "companies"
    assert landed.sql().split("ORDER BY", 1)[1].split("LIMIT", 1)[0].strip() == f"{table}.created_at DESC"


async def test_untyped_union_truncates_person_branch(landed):
    landed.add(full_name="Smith", created_at=datetime(2026, 2, 1))
    company = landed.add("Company", legal_name="Smith")
    data = await landed.service.search_entities(None, "Smith", limit=1)
    assert [row["id"] for row in data] == [str(company.id)]
    assert len(landed.adapter.statements) == 2


@pytest.mark.parametrize("column,expected", [("AB123456", "AB123456"), (None, "PROFILE123"), ("", "PROFILE123")])
async def test_actual_passport_serializer_column_and_profile_fallback(landed, column, expected):
    person = landed.add(full_name="Passport Person", passport_no=column, profile={"passport_number": "PROFILE123"})
    data = await landed.service._person_to_dict(person)
    assert data["passport_number"] == expected
    assert data["id_number"] is None
    assert "entity_type" not in data


async def test_passport_column_matches_but_profile_only_value_does_not(landed):
    person = landed.add(full_name="Ada", passport_no="AB123456", profile={"passport_number": "PROFILE123"})
    response = await landed.route(query="ab123", entity_type="person")
    envelope = json.loads(response.body)
    assert set(envelope) == {"message", "data"}
    assert envelope["message"] == "Search results"
    assert isinstance(envelope["data"], list)
    assert envelope["data"][0]["id"] == str(person.id)
    assert envelope["data"][0]["passport_number"] == "AB123456"
    assert "entity_type" not in envelope["data"][0]
    where = landed.sql().split("WHERE", 1)[1]
    for field in ["full_name", "national_id", "passport_no", "email"]:
        assert f"persons.{field} ILIKE" in where
    assert await landed.service.search_entities(None, "PROFILE123", entity_type="person") == []


@pytest.mark.parametrize("column,expected_type,expected_trust", [("Trust", "Trust", True), ("Private", "Private", False), (None, "Trust", True), ("", "", False), ("trust", "trust", False)])
async def test_actual_company_type_fallback_and_column_only_office(landed, column, expected_type, expected_trust):
    row = landed.add("Company", company_type=column, masters_office=None, profile={"company_type": "Trust", "masters_office": "cape_town", "high_court": "Cape Town"})
    data = landed.service._company_to_dict(row)
    assert data["entity_type"] == "company"
    assert data["company_type"] == expected_type
    assert data["is_trust"] is expected_trust
    assert data["masters_office"] is None


async def test_profile_only_trust_has_documented_sql_serializer_mismatch(landed):
    row = landed.add("Company", legal_name="Legacy Trust", company_type=None, profile={"company_type": "Trust"})
    assert await landed.service.search_entities(None, "Legacy", entity_type="trust") == []
    data = await landed.service.search_entities(None, "Legacy", entity_type="company")
    assert data[0]["id"] == str(row.id)
    assert data[0]["is_trust"] is True


async def test_actual_upstream_output_is_filtered_by_ai_not_creator(landed):
    visible = landed.add(full_name="Shared Person", passport_no="AB123", tenant_id=OTHER_CREATOR)
    hidden = landed.add(full_name="Hidden Person", passport_no="AB999", tenant_id=CREATOR)
    async with _Gateway(landed, {(str(visible.id), AI), (str(hidden.id), AI + 1)}) as gateway:
        result = await GoldenRecordSearchService(gateway.client).search(entity_type="person", accountable_institution_id=AI, query="AB")
    assert result.status is SearchStatus.MATCHED
    assert result.record.golden_record_id == str(visible.id)
    assert result.record.entity_type == "person"
    assert result.record.id_number == "AB123"
    assert result.record.name == "Shared Person"
    assert {row["id"] for row in gateway.responses[0]["data"]} == {str(visible.id), str(hidden.id)}
    assert str(hidden.id) not in repr(result)
    assert "Hidden Person" not in repr(result)
    assert str(OTHER_CREATOR) not in repr(result)
    assert gateway.authorized == {str(visible.id)}
    assert all(request.url.params["accountable_institution_id"] == str(AI) for request in gateway.requests if "/by-golden-record/" in request.url.path)


async def test_same_registration_different_offices_remain_visible_ambiguous_trusts(landed):
    trusts = [landed.add("Company", legal_name="Smith Family", registration_no="1841/2023", company_type="Trust", masters_office=office) for office in ["cape_town", "johannesburg"]]
    async with _Gateway(landed, {(str(row.id), AI) for row in trusts}) as gateway:
        result = await GoldenRecordSearchService(gateway.client).search(entity_type="trust", accountable_institution_id=AI, query="1841/2023")
    assert result.status is SearchStatus.AMBIGUOUS
    assert {candidate.golden_record_id for candidate in result.candidates} == {str(row.id) for row in trusts}
    assert {candidate.masters_office for candidate in result.candidates} == {"cape_town", "johannesburg"}
    assert all(candidate.is_trust is True and candidate.registration_no == "1841/2023" for candidate in result.candidates)
    gets = [request for request in gateway.requests if request.url.path.startswith("/api/v1/entities/") and request.method == "GET"]
    assert len(gets) == 2
    assert all(request.url.params["entity_type"] == "company" for request in gets)


async def test_actual_get_person_falls_back_to_company_and_deedly_rejects_type(landed):
    row = landed.add("Company", legal_name="Acme", company_type="Private")
    data = await landed.service.get_entity(row.id, "person")
    assert data["entity_type"] == "company"
    from services.golden_record_visibility import GoldenRecordVisibilityError, resolve_visible_golden_record
    async with _Gateway(landed, {(str(row.id), AI)}) as gateway:
        with pytest.raises(GoldenRecordVisibilityError):
            await resolve_visible_golden_record(gateway.client, golden_record_id=row.id, accountable_institution_id=AI, expected_entity_type="person")


@pytest.mark.parametrize("visible_count", [0, 1, 2])
async def test_real_multipage_results_classify_after_exhaustion(landed, monkeypatch, visible_count):
    monkeypatch.setattr(deedly_search, "SEARCH_PAGE_SIZE", 2)
    rows = [landed.add(full_name=f"Smith {index}", created_at=datetime(2026, 1, 1)) for index in range(3)]
    linkages = {(str(row.id), AI) for row in rows[:visible_count]}
    async with _Gateway(landed, linkages) as gateway:
        result = await GoldenRecordSearchService(gateway.client).search(
            entity_type="person", accountable_institution_id=AI, query="Smith"
        )
        if visible_count == 0:
            assert result.status is SearchStatus.NOT_FOUND
        elif visible_count == 1:
            assert result.status is SearchStatus.MATCHED
        else:
            assert result.status is SearchStatus.AMBIGUOUS
            assert len(result.candidates) == 2
    assert [json.loads(request.content)["offset"] for request in gateway.requests if request.method == "POST"] == [0, 2]
    assert all("id DESC" not in landed.sql(index) for index in range(len(landed.adapter.statements)))


@pytest.mark.parametrize("visible_count", [0, 1])
async def test_deedly_route_maps_capped_multipage_scan_to_503(landed, monkeypatch, visible_count):
    monkeypatch.setattr(deedly_search, "SEARCH_PAGE_SIZE", 2)
    monkeypatch.setattr(deedly_search, "SEARCH_MAX_PAGES", 1)
    rows = [landed.add(full_name=f"Smith {index}") for index in range(3)]
    user = SimpleNamespace(is_client=False, has_ability=lambda ability: ability == "transfers:read", accountable_institution_id=AI)
    async with _Gateway(landed, {(str(row.id), AI) for row in rows[:visible_count]}) as gateway:
        response = await search_golden_records({"entity_type": "person", "query": "Smith"}, user=user, entities_client=gateway.client)
    assert response.status_code == 503
    assert json.loads(response.body)["success"] is False
    assert "Smith" not in response.body.decode()


@pytest.mark.parametrize("kind", ["person", "company", "trust"])
async def test_retrieval_projects_actual_landed_serializer_without_private_fields(landed, kind):
    from services.golden_record_visibility import resolve_visible_golden_record

    if kind == "person":
        row = landed.add(full_name="Canonical Person", passport_no="AB123", cellphone=" +27 21 000 0000 ",
                         residential_address=" 1 Test Road ", tenant_id=OTHER_CREATOR,
                         profile={"cellphone": "PRIVATE-PHONE", "private": "PRIVATE-PROFILE"})
    else:
        row = landed.add("Company", legal_name="Canonical Legal Name", registration_no="REG-1",
                         company_type="Trust" if kind == "trust" else "Private", masters_office="cape_town" if kind == "trust" else None,
                         phone_number=" +27 21 000 0000 ", tenant_id=OTHER_CREATOR,
                         profile={"office_address": "1 Test Road", "phone_number": "PRIVATE-PHONE", "private": "PRIVATE-PROFILE"})
    async with _Gateway(landed, {(str(row.id), AI)}) as gateway:
        visible = await resolve_visible_golden_record(gateway.client, golden_record_id=row.id,
                                                      accountable_institution_id=AI, expected_entity_type=kind)
        data = visible.details
        assert [request.method for request in gateway.requests] == ["GET", "GET"]
        assert gateway.requests[-1].url.params["entity_type"] == ("person" if kind == "person" else "company")
    assert data["goldenRecordId"] == str(row.id)
    assert data["entityType"] == kind
    assert data["phone"] == "+27 21 000 0000"
    assert data["address"] == "1 Test Road"
    assert "PRIVATE" not in repr(data)
    assert str(OTHER_CREATOR) not in repr(data)
    expected_keys = {"goldenRecordId", "entityType", "name", "idNumber", "email", "phone", "address"}
    if kind == "person":
        assert "entity_type" not in visible.entity
        assert data["idNumber"] == "AB123"
    else:
        expected_keys |= {"registrationNo", "mastersOffice", "isTrust"}
        assert data["isTrust"] is (kind == "trust")
        assert data["registrationNo"] == "REG-1"
    assert set(data) == expected_keys


@pytest.mark.parametrize("kind,company_type", [("person", "Private"), ("company", "Trust"), ("trust", "Private")])
async def test_retrieval_rejects_actual_landed_company_logical_mismatches(landed, kind, company_type):
    from services.golden_record_visibility import GoldenRecordVisibilityError, resolve_visible_golden_record

    row = landed.add("Company", legal_name="PRIVATE-NAME", company_type=company_type)
    async with _Gateway(landed, {(str(row.id), AI)}) as gateway:
        with pytest.raises(GoldenRecordVisibilityError) as error:
            await resolve_visible_golden_record(gateway.client, golden_record_id=row.id,
                                                accountable_institution_id=AI, expected_entity_type=kind)
    assert "PRIVATE-NAME" not in error.value.public_message


async def test_retrieval_of_actual_person_as_company_and_missing_entity_fails_safely(landed):
    from services.golden_record_visibility import GoldenRecordVisibilityError, resolve_visible_golden_record

    person = landed.add(full_name="PRIVATE-NAME")
    for entity_id, kind in ((person.id, "company"), (uuid4(), "person")):
        async with _Gateway(landed, {(str(entity_id), AI)}) as gateway:
            with pytest.raises(GoldenRecordVisibilityError) as error:
                await resolve_visible_golden_record(gateway.client, golden_record_id=entity_id,
                                                    accountable_institution_id=AI, expected_entity_type=kind)
        assert error.value.http_status == 400
        assert error.value.public_message == "Unknown or inaccessible Golden Record"


async def test_retrieval_never_fetches_actual_entity_linked_only_to_another_ai(landed):
    from services.golden_record_visibility import GoldenRecordVisibilityError, resolve_visible_golden_record

    row = landed.add(full_name="PRIVATE-NAME", tenant_id=CREATOR)
    async with _Gateway(landed, {(str(row.id), AI + 1)}) as gateway:
        with pytest.raises(GoldenRecordVisibilityError) as error:
            await resolve_visible_golden_record(gateway.client, golden_record_id=row.id,
                                                accountable_institution_id=AI, expected_entity_type="person")
        assert len(gateway.requests) == 1
        assert not gateway.authorized
    assert error.value.http_status == 400


async def test_retrieval_keeps_same_number_trusts_distinct_and_accepts_landed_profile_classification(landed):
    from services.golden_record_visibility import resolve_visible_golden_record

    rows = [landed.add("Company", legal_name="Family Trust", registration_no="1841/2023", company_type=tag,
                       masters_office=office, profile={"company_type": "Trust"})
            for tag, office in (("Trust", "cape_town"), (None, "johannesburg"))]
    async with _Gateway(landed, {(str(row.id), AI) for row in rows}) as gateway:
        details = [(await resolve_visible_golden_record(gateway.client, golden_record_id=row.id,
                    accountable_institution_id=AI, expected_entity_type="trust")).details for row in rows]
    assert {data["goldenRecordId"] for data in details} == {str(row.id) for row in rows}
    assert {data["mastersOffice"] for data in details} == {"cape_town", "johannesburg"}
    assert all(data["isTrust"] is True for data in details)


@pytest.mark.parametrize("kind", ["person", "company"])
async def test_malformed_contact_values_from_actual_serializer_are_not_displayed(landed, kind):
    from services.golden_record_visibility import GoldenRecordVisibilityError, resolve_visible_golden_record

    row = landed.add(cellphone={"private": "PRIVATE-DATA"}) if kind == "person" else landed.add(
        "Company", company_type="Private", profile={"office_address": ["PRIVATE-DATA"]},
    )
    async with _Gateway(landed, {(str(row.id), AI)}) as gateway:
        with pytest.raises(GoldenRecordVisibilityError) as error:
            visible = await resolve_visible_golden_record(gateway.client, golden_record_id=row.id,
                                                          accountable_institution_id=AI, expected_entity_type=kind)
            _ = visible.details
    assert error.value.http_status == 503
    assert "PRIVATE-DATA" not in error.value.public_message


@pytest.fixture
def submission_source(landed):
    landed.ns.update(model_validator=model_validator, re=re)
    _load(landed.ns, "services/entities/src/api/v1/schemas.py", "SubmitClientRequest")
    _load(landed.ns, ROUTES, "submit_client", remove_decorators=True)
    trust_path = SHARED + "utils/trust.py"
    tree = ast.parse((SOURCE_ROOT / trust_path).read_text(encoding="utf-8-sig"))
    noise = next(node.value for node in tree.body if isinstance(node, ast.Assign)
                 and any(isinstance(target, ast.Name) and target.id == "_MASTERS_OFFICE_NOISE" for target in node.targets))
    landed.ns["_MASTERS_OFFICE_NOISE"] = ast.literal_eval(noise)
    for name in ("normalise_trust_number", "normalise_masters_office"):
        _load(landed.ns, trust_path, name)
    return landed


@pytest.mark.parametrize("kind,submission", [
    ("person", PersonSubmission(tenant_id=CREATOR, id_number="6202268145089")),
    ("person", PersonSubmission(tenant_id=CREATOR, id_number="6202268145089", first_name="Draft", surname="Name",
                                email="draft@example.invalid", cellphone="", is_south_african=True, lookup_profile_slug="source-profile")),
    ("company", CompanySubmission(tenant_id=CREATOR, registration_no="2026/123456/07")),
    ("company", CompanySubmission(tenant_id=CREATOR, registration_no="2026/123456/07", legal_name="Draft Company")),
    ("trust", TrustSubmission(tenant_id=CREATOR, registration_no="IT001841/2023(G)", masters_office="Cape Town")),
    ("trust", TrustSubmission(tenant_id=CREATOR, registration_no="001841/2023", masters_office="Johannesburg", legal_name="Draft Trust")),
])
async def test_submit_adapters_round_trip_actual_schema_route_and_serializers(submission_source, kind, submission):
    source = submission_source
    payload = submission.to_payload()
    body = source.ns["SubmitClientRequest"](**payload)
    if kind == "person":
        row = source.add(full_name="Canonical Person", national_id=body.id_number, tenant_id=OTHER_CREATOR)
        data = await source.service._person_to_dict(row)
    else:
        row = source.add("Company", legal_name="Canonical Organisation", registration_no=body.id_number,
                         company_type="Trust" if kind == "trust" else "Private",
                         masters_office=body.masters_office, tenant_id=OTHER_CREATOR)
        data = source.service._company_to_dict(row)
    service = SimpleNamespace(handle_submit_client=AsyncMock(return_value=data))
    source.ns["_get_entity_service"] = lambda request, session: service
    result = await source.ns["submit_client"](body, source.request, caller=None, session=None)
    assert result.status_code == 201
    assert set(json.loads(result.body)) == {"message", "data"}
    options = {"expected_masters_office": submission.masters_office} if kind == "trust" else {}
    parsed = parse_submission_response(httpx.Response(result.status_code, content=result.body), kind, **options)
    assert parsed.golden_record_id == row.id
    assert parsed.entity_type == kind
    assert set(vars(parsed)) == {"golden_record_id", "entity_type"}
    assert "Canonical" not in repr(parsed)
    kwargs = service.handle_submit_client.await_args.kwargs
    assert kwargs["tenant_id"] == CREATOR
    assert kwargs["id_number"] == payload["id_number"]
    assert kwargs["is_company"] is (kind != "person")
    assert kwargs["is_trust"] is (kind == "trust")
    assert kwargs["is_south_african"] is payload.get("is_south_african", False)
    assert kwargs["passport_number"] is None and kwargs["passport_country"] is None
    assert kwargs["force_refresh"] is False
    assert kwargs["accountable_institution_id"] is None and kwargs["user_id"] == 0
    assert kwargs["lookup_profile_slug"] == payload.get("lookup_profile_slug")
    assert kwargs["extra_data"] == (body.model_dump(exclude={
        "id_number", "passport_number", "passport_country", "tenant_id", "is_company", "is_trust",
        "is_south_african", "lookup_profile_slug",
    }, exclude_none=True) or None)


@pytest.mark.parametrize("number,office", [
    ("IT 1841/2023(G)", "CAPE TOWN MASTERS OFFICE"),
    ("IT001841/2023J", "Johannesburg"),
    ("  IT001841/2023(JHB)", "JOHANNESBURG MASTERS OFFICE"),
    ("it 1841/2023 (g)", "master of the high court Cape Town"),
    ("1841/2023", "Port Elizabeth"),
    ("1841/2023", "pretoria"),
])
async def test_trust_adapter_matches_selected_source_normalizers(submission_source, number, office):
    payload = TrustSubmission(tenant_id=CREATOR, registration_no=number, masters_office=office).to_payload()
    assert payload["id_number"] == submission_source.ns["normalise_trust_number"](number)
    assert payload["masters_office"] == submission_source.ns["normalise_masters_office"](office)
    submission_source.ns["SubmitClientRequest"](**payload)


async def test_submit_source_does_not_supply_product_required_fields(submission_source):
    model = submission_source.ns["SubmitClientRequest"]
    minimal = model(tenant_id=CREATOR, id_number="1")
    assert all(getattr(minimal, field) is None for field in ("first_name", "surname", "email", "cellphone", "legal_name"))
    assert model(tenant_id=CREATOR, id_number="1", email="not-an-email").email == "not-an-email"
    assert model(tenant_id=CREATOR, id_number="1841/2023", is_trust=True).masters_office is None
    with pytest.raises(ValueError):
        TrustSubmission(tenant_id=CREATOR, registration_no="1841/2023", masters_office="").to_payload()


@pytest.mark.parametrize("payload", [
    {"id_number": "1"}, {"tenant_id": "not-a-uuid", "id_number": "1"},
    {"tenant_id": CREATOR}, {"tenant_id": CREATOR, "id_number": " "},
    {"tenant_id": CREATOR, "id_number": "X" * 51}, {"tenant_id": CREATOR, "id_number": []},
    {"tenant_id": CREATOR, "passport_number": "AB123"},
    {"tenant_id": CREATOR, "id_number": "1", "passport_number": "AB123", "passport_country": "GB"},
    {"tenant_id": CREATOR, "passport_number": "AB123", "passport_country": "GBR"},
])
async def test_actual_submit_schema_rejects_structural_errors(submission_source, payload):
    with pytest.raises(ValidationError):
        submission_source.ns["SubmitClientRequest"](**payload)


async def test_passport_schema_and_unique_key_limitations_do_not_enable_an_adapter(submission_source):
    source = submission_source
    model = source.ns["SubmitClientRequest"]
    assert model(tenant_id=CREATOR, passport_number="AB123", passport_country="g").passport_country == "G"
    assert model(tenant_id=CREATOR, id_number="1", passport_country="ZZ").passport_country == "ZZ"
    person = source.add(passport_no="AB123", tenant_id=OTHER_CREATOR)
    repo_class = _load(source.ns, REPOSITORIES, "PersonRepository", ["get_by_passport_no"])
    repo = repo_class()
    repo._session = source.adapter
    for country in ("GB", "US"):
        body = model(tenant_id=CREATOR, passport_number="AB123", passport_country=country)
        assert (await repo.get_by_passport_no(body.passport_number)).id == person.id
        where = source.sql().split("WHERE", 1)[1].split("ORDER BY", 1)[0]
        assert "passport_no" in where and "country" not in where and "tenant_id" not in where
        with pytest.raises(TypeError):
            PersonSubmission(tenant_id=CREATOR, passport_number=body.passport_number, passport_country=body.passport_country)
    upgrade = _node("services/entities/alembic/versions/0039_unique_passport_no.py", "upgrade")
    index_sql = " ".join(ast.literal_eval(upgrade.body[0].value.args[0]).split())
    assert "ON persons (passport_no)" in index_sql
    assert "passport_country" not in index_sql


async def test_source_passport_creation_skips_provider_orchestration(submission_source):
    source = submission_source
    person = source.add(passport_no="AB123", national_id=None)
    source.ns.update(logger=Mock(), OrchestratorService=Mock(side_effect=AssertionError("No provider execution permitted")))
    _load(source.ns, ENTITY_SERVICE, "_compose_full_name")
    handle_submit = _load(source.ns, ENTITY_SERVICE, "EntityService.handle_submit_client")
    service = source.service
    service._providers = {}
    service._log_audit = AsyncMock()
    service._person_repo.get_by_passport_no = AsyncMock(return_value=None)
    service._person_repo.create = AsyncMock(return_value=person)
    result = await handle_submit(service, tenant_id=CREATOR, passport_number="AB123", passport_country="GB")
    assert result["id"] == str(person.id)
    assert result["id_number"] is None and result["status"] == "active"
    assert service._person_repo.create.await_args.kwargs == {
        "passport_no": "AB123", "tenant_id": CREATOR, "country_of_residence_iso": "GB",
    }
    source.ns["OrchestratorService"].assert_not_called()


async def test_submit_endpoint_path_is_confirmed_by_source(submission_source):
    endpoint = _node(ROUTES, "submit_client").decorator_list[0]
    assert endpoint.func.attr == "post"
    assert ast.literal_eval(endpoint.args[0]) == "/submit"
