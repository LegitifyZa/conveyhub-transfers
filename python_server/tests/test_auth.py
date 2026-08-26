import os
import time
import uuid
from types import SimpleNamespace
from unittest import IsolatedAsyncioTestCase, TestCase

import jwt as pyjwt
from fastapi import FastAPI
from fastapi.exceptions import HTTPException

from auth.current_user import CurrentUser
from auth.dependencies import require_ability, require_jwt, require_jwt_or_service_key
from auth.jwt import JWTVerificationError, verify_jwt
from auth.service_key import ServiceKeyError, verify_service_key
from config import load_settings


TEST_JWT_SECRET = "test-jwt-secret-32-bytes-long!!"
TEST_SERVICE_SECRET = "test-service-secret-32-bytes!!"


def _make_token(claims=None, secret=TEST_JWT_SECRET, **overrides):
    payload = {
        "type": "access",
        "user_id": 123,
        "golden_record_id": str(uuid.uuid4()),
        "abilities": ["api", "transfers:read"],
        "accountable_institution_id": 2,
        "user_roles_id": 3,
        "tenant_id": str(uuid.uuid4()),
        "iat": int(time.time()),
    }
    if claims:
        payload.update(claims)
    payload.update(overrides)
    if "exp" not in payload:
        payload["exp"] = int(time.time()) + 3600
    return pyjwt.encode(payload, secret, algorithm="HS256")


class CurrentUserTests(TestCase):
    def test_helpers(self):
        user = CurrentUser(
            user_id=1,
            golden_record_id=None,
            abilities=["transfers:read"],
            accountable_institution_id=2,
            user_roles_id=1,
            tenant_id=None,
        )
        self.assertTrue(user.is_super_admin)
        self.assertFalse(user.is_client)
        self.assertTrue(user.has_ability("transfers:read"))

    def test_is_client_for_role_4(self):
        user = CurrentUser(
            user_id=1,
            golden_record_id=None,
            abilities=[],
            accountable_institution_id=2,
            user_roles_id=4,
            tenant_id=None,
        )
        self.assertFalse(user.is_super_admin)
        self.assertTrue(user.is_client)


class VerifyJwtTests(TestCase):
    def test_valid_jwt_returns_current_user(self):
        token = _make_token()
        user = verify_jwt(token, TEST_JWT_SECRET)
        self.assertEqual(user.user_id, 123)
        self.assertEqual(user.accountable_institution_id, 2)
        self.assertEqual(user.user_roles_id, 3)
        self.assertEqual(user.abilities, ["api", "transfers:read"])

    def test_missing_bearer_header(self):
        with self.assertRaises(JWTVerificationError):
            verify_jwt("", TEST_JWT_SECRET)

    def test_malformed_token(self):
        with self.assertRaises(JWTVerificationError):
            verify_jwt("not-a-jwt", TEST_JWT_SECRET)

    def test_invalid_signature(self):
        token = _make_token(secret="different-secret-32-bytes-long!!")
        with self.assertRaises(JWTVerificationError):
            verify_jwt(token, TEST_JWT_SECRET)

    def test_expired_jwt(self):
        token = _make_token(exp=int(time.time()) - 10)
        with self.assertRaises(JWTVerificationError) as ctx:
            verify_jwt(token, TEST_JWT_SECRET)
        self.assertIn("expired", str(ctx.exception).lower())

    def test_missing_required_claims(self):
        token = pyjwt.encode(
            {"type": "access", "user_id": 1, "exp": int(time.time()) + 3600},
            TEST_JWT_SECRET,
            algorithm="HS256",
        )
        with self.assertRaises(JWTVerificationError) as ctx:
            verify_jwt(token, TEST_JWT_SECRET)
        self.assertIn("missing required claims", str(ctx.exception).lower())

    def test_malformed_claim_types(self):
        token = _make_token(user_id="not-an-int")
        with self.assertRaises(JWTVerificationError) as ctx:
            verify_jwt(token, TEST_JWT_SECRET)
        self.assertIn("user_id", str(ctx.exception))

    def test_invalid_golden_record_id_type(self):
        token = _make_token(golden_record_id="not-a-uuid")
        with self.assertRaises(JWTVerificationError) as ctx:
            verify_jwt(token, TEST_JWT_SECRET)
        self.assertIn("golden_record_id", str(ctx.exception))

    def test_invalid_tenant_id_type(self):
        token = _make_token(tenant_id="not-a-uuid")
        with self.assertRaises(JWTVerificationError) as ctx:
            verify_jwt(token, TEST_JWT_SECRET)
        self.assertIn("tenant_id", str(ctx.exception))

    def test_invalid_type(self):
        token = _make_token(type="refresh")
        with self.assertRaises(JWTVerificationError) as ctx:
            verify_jwt(token, TEST_JWT_SECRET)
        self.assertIn("type", str(ctx.exception).lower())

    def test_jwt_secret_not_configured(self):
        token = _make_token()
        with self.assertRaises(JWTVerificationError):
            verify_jwt(token, "")

    def test_wrong_algorithm_rejected(self):
        token = _make_token(algorithm="HS384", secret="another-32-bytes-secret!!")
        with self.assertRaises(JWTVerificationError):
            verify_jwt(token, TEST_JWT_SECRET)

    def test_none_algorithm_rejected(self):
        # Manually build an alg=none token
        import base64
        import json

        header = base64.urlsafe_b64encode(
            json.dumps({"alg": "none", "typ": "JWT"}).encode()
        ).rstrip(b"=")
        payload = base64.urlsafe_b64encode(
            json.dumps({"type": "access", "user_id": 1, "exp": int(time.time()) + 3600}).encode()
        ).rstrip(b"=")
        token = f"{header.decode()}.{payload.decode()}."
        with self.assertRaises(JWTVerificationError):
            verify_jwt(token, TEST_JWT_SECRET)

    def test_raw_token_never_logged(self):
        token = _make_token(user_id="bad")
        try:
            verify_jwt(token, TEST_JWT_SECRET)
        except JWTVerificationError as exc:
            self.assertNotIn(token, str(exc))


class ServiceKeyTests(TestCase):
    def test_valid_service_key(self):
        verify_service_key(TEST_SERVICE_SECRET, TEST_SERVICE_SECRET)

    def test_invalid_service_key(self):
        with self.assertRaises(ServiceKeyError):
            verify_service_key("wrong", TEST_SERVICE_SECRET)

    def test_missing_service_key(self):
        with self.assertRaises(ServiceKeyError):
            verify_service_key("", TEST_SERVICE_SECRET)

    def test_service_key_not_configured(self):
        with self.assertRaises(ServiceKeyError):
            verify_service_key(TEST_SERVICE_SECRET, "")


class DependenciesTests(IsolatedAsyncioTestCase):
    async def test_require_jwt_or_service_key_service(self):
        app = FastAPI()
        app.state.settings = SimpleNamespace(
            secret_key=TEST_SERVICE_SECRET, jwt_secret=TEST_JWT_SECRET
        )
        request = SimpleNamespace(app=app, headers={}, scope={"type": "http"})
        result = await require_jwt_or_service_key(
            request, None, TEST_SERVICE_SECRET
        )
        self.assertIsNone(result)

    async def test_require_jwt_or_service_key_jwt(self):
        app = FastAPI()
        app.state.settings = SimpleNamespace(
            secret_key=TEST_SERVICE_SECRET, jwt_secret=TEST_JWT_SECRET
        )
        request = SimpleNamespace(app=app, headers={}, scope={"type": "http"})
        token = _make_token()
        result = await require_jwt_or_service_key(
            request, f"Bearer {token}", None
        )
        self.assertIsInstance(result, CurrentUser)
        self.assertEqual(result.user_id, 123)

    async def test_require_jwt_or_service_key_missing(self):
        app = FastAPI()
        app.state.settings = SimpleNamespace(
            secret_key=TEST_SERVICE_SECRET, jwt_secret=TEST_JWT_SECRET
        )
        request = SimpleNamespace(app=app, headers={}, scope={"type": "http"})
        with self.assertRaises(HTTPException) as ctx:
            await require_jwt_or_service_key(request, None, None)
        self.assertEqual(ctx.exception.status_code, 401)

    async def test_require_jwt_or_service_key_invalid_service(self):
        app = FastAPI()
        app.state.settings = SimpleNamespace(
            secret_key=TEST_SERVICE_SECRET, jwt_secret=TEST_JWT_SECRET
        )
        request = SimpleNamespace(app=app, headers={}, scope={"type": "http"})
        with self.assertRaises(HTTPException) as ctx:
            await require_jwt_or_service_key(request, None, "wrong")
        self.assertEqual(ctx.exception.status_code, 401)

    async def test_require_ability_present(self):
        app = FastAPI()
        app.state.settings = SimpleNamespace(
            secret_key=TEST_SERVICE_SECRET, jwt_secret=TEST_JWT_SECRET
        )
        request = SimpleNamespace(app=app, headers={}, scope={"type": "http"})
        token = _make_token()
        user = await require_jwt(request, f"Bearer {token}")
        handler = require_ability("transfers:read")
        result = await handler(user=user)
        self.assertIsInstance(result, CurrentUser)

    async def test_require_ability_missing(self):
        app = FastAPI()
        app.state.settings = SimpleNamespace(
            secret_key=TEST_SERVICE_SECRET, jwt_secret=TEST_JWT_SECRET
        )
        request = SimpleNamespace(app=app, headers={}, scope={"type": "http"})
        token = _make_token(abilities=["api"])
        user = await require_jwt(request, f"Bearer {token}")
        handler = require_ability("transfers:write")
        with self.assertRaises(HTTPException) as ctx:
            await handler(user=user)
        self.assertEqual(ctx.exception.status_code, 403)

    async def test_jwt_and_service_key_distinguishable(self):
        app = FastAPI()
        app.state.settings = SimpleNamespace(
            secret_key=TEST_SERVICE_SECRET, jwt_secret=TEST_JWT_SECRET
        )
        request = SimpleNamespace(app=app, headers={}, scope={"type": "http"})
        jwt_user = await require_jwt_or_service_key(
            request, f"Bearer {_make_token()}", None
        )
        s2s = await require_jwt_or_service_key(
            request, None, TEST_SERVICE_SECRET
        )
        self.assertIsInstance(jwt_user, CurrentUser)
        self.assertIsNone(s2s)


class ProductionJwtSecretTests(TestCase):
    def test_verify_jwt_rejects_missing_jwt_secret(self):
        token = _make_token()
        with self.assertRaises(JWTVerificationError) as ctx:
            verify_jwt(token, None)
        self.assertIn("not configured", str(ctx.exception).lower())

    def test_verify_jwt_rejects_empty_jwt_secret(self):
        token = _make_token()
        with self.assertRaises(JWTVerificationError) as ctx:
            verify_jwt(token, "")
        self.assertIn("not configured", str(ctx.exception).lower())


