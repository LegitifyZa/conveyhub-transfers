import uuid
from unittest import TestCase

from auth.current_user import CurrentUser
from auth.policy import (
    AuthorizationDecision,
    TenantBoundaryError,
    authorize_mutation,
    authorize_record_access,
    resolve_effective_tenant_id,
    resolve_write_tenant_id,
)


def _user(role, ai, golden=None):
    return CurrentUser(
        user_id=1,
        golden_record_id=golden,
        abilities=[],
        accountable_institution_id=ai,
        user_roles_id=role,
        tenant_id=None,
    )


class TenantIsolationTests(TestCase):
    """Approved policy: same-institution isolation for every caller.

    Institution scoping is independent of user_roles_id — no role,
    including platform roles 1/6 (or any future privileged role), may
    read, list or mutate another accountable institution's records.
    """

    def test_no_role_has_a_cross_institution_exception(self):
        for role in (1, 2, 3, 5, 6):
            with self.subTest(role=role):
                user = _user(role, 2)
                self.assertEqual(
                    authorize_record_access(user, 99), AuthorizationDecision.NOT_FOUND
                )
                self.assertEqual(
                    authorize_record_access(user, 2), AuthorizationDecision.ALLOWED
                )
                self.assertEqual(
                    authorize_mutation(user, 99), AuthorizationDecision.NOT_FOUND
                )
                self.assertEqual(
                    authorize_mutation(user, 2), AuthorizationDecision.ALLOWED
                )


class TenantResolutionTests(TestCase):
    def test_privileged_roles_cannot_select_another_ai(self):
        for role in (1, 6):
            with self.subTest(role=role):
                with self.assertRaises(TenantBoundaryError):
                    resolve_effective_tenant_id(_user(role, 2), 99)

    def test_privileged_roles_default_to_own_ai(self):
        for role in (1, 6):
            with self.subTest(role=role):
                self.assertEqual(resolve_effective_tenant_id(_user(role, 2)), 2)

    def test_staff_locked_to_own_ai(self):
        user = _user(3, 2)
        self.assertEqual(resolve_effective_tenant_id(user), 2)

    def test_staff_matching_requested_ai(self):
        user = _user(3, 2)
        self.assertEqual(resolve_effective_tenant_id(user, 2), 2)

    def test_staff_mismatching_requested_ai_raises(self):
        user = _user(3, 2)
        with self.assertRaises(TenantBoundaryError):
            resolve_effective_tenant_id(user, 99)


class RecordAccessTests(TestCase):
    def test_privileged_roles_foreign_tenant_not_found(self):
        for role in (1, 6):
            with self.subTest(role=role):
                user = _user(role, 2)
                self.assertEqual(
                    authorize_record_access(user, 99), AuthorizationDecision.NOT_FOUND
                )
                self.assertEqual(
                    authorize_mutation(user, 99), AuthorizationDecision.NOT_FOUND
                )

    def test_staff_same_tenant_allowed(self):
        user = _user(3, 2)
        self.assertEqual(
            authorize_record_access(user, 2), AuthorizationDecision.ALLOWED
        )

    def test_staff_foreign_tenant_not_found(self):
        user = _user(3, 2)
        self.assertEqual(
            authorize_record_access(user, 99), AuthorizationDecision.NOT_FOUND
        )

    def test_client_same_tenant_needs_party_check(self):
        user = _user(4, 2, golden=uuid.uuid4())
        self.assertEqual(
            authorize_record_access(user, 2),
            AuthorizationDecision.CLIENT_PARTY_CHECK_REQUIRED,
        )

    def test_client_party_identity_does_not_override_institution(self):
        user = _user(4, 2, golden=uuid.uuid4())
        self.assertEqual(authorize_record_access(user, 99), AuthorizationDecision.NOT_FOUND)
        self.assertEqual(authorize_mutation(user, 99), AuthorizationDecision.NOT_FOUND)

    def test_missing_or_invalid_institution_never_grants_access(self):
        for role in (1, 3, 4, 6):
            for ai in (None, False, 0, -1, 2.5, "2"):
                with self.subTest(role=role, ai=ai):
                    user = _user(role, ai, golden=uuid.uuid4())
                    self.assertEqual(authorize_record_access(user, 2), AuthorizationDecision.NOT_FOUND)
                    with self.assertRaises(TenantBoundaryError):
                        resolve_effective_tenant_id(user)
                    self.assertEqual(authorize_record_access(_user(role, 2), ai), AuthorizationDecision.NOT_FOUND)

    def test_invalid_explicit_scope_never_becomes_an_unrestricted_lookup(self):
        for role in (1, 3, 6):
            for requested in (False, 0, -1, 2.5, "2"):
                with self.subTest(role=role, requested=requested):
                    with self.assertRaises(TenantBoundaryError):
                        resolve_effective_tenant_id(_user(role, 2), requested)

    def test_client_without_golden_record_not_found(self):
        user = _user(4, 2, golden=None)
        self.assertEqual(
            authorize_record_access(user, 2), AuthorizationDecision.NOT_FOUND
        )

    def test_mutation_foreign_tenant_not_found(self):
        user = _user(3, 2)
        self.assertEqual(
            authorize_mutation(user, 99), AuthorizationDecision.NOT_FOUND
        )

    def test_cross_tenant_roles_cannot_mutate_foreign_tenant(self):
        for role in (1, 6):
            with self.subTest(role=role):
                user = _user(role, 2)
                self.assertEqual(
                    authorize_mutation(user, 99), AuthorizationDecision.NOT_FOUND
                )
                self.assertEqual(
                    authorize_mutation(user, 2), AuthorizationDecision.ALLOWED
                )


class WriteTenantResolutionTests(TestCase):
    def test_cross_tenant_roles_are_locked_to_own_ai_for_writes(self):
        for role in (1, 6):
            with self.subTest(role=role):
                user = _user(role, 2)
                self.assertEqual(resolve_write_tenant_id(user), 2)
                self.assertEqual(resolve_write_tenant_id(user, 2), 2)
                with self.assertRaises(TenantBoundaryError):
                    resolve_write_tenant_id(user, 99)

    def test_staff_write_resolution_matches_read_resolution(self):
        user = _user(3, 2)
        self.assertEqual(resolve_write_tenant_id(user), 2)
        self.assertEqual(resolve_write_tenant_id(user, 2), 2)
        with self.assertRaises(TenantBoundaryError):
            resolve_write_tenant_id(user, 99)

    def test_invalid_requested_ai_never_resolves_a_write_tenant(self):
        for role in (1, 3, 6):
            for requested in (False, 0, -1, 2.5, "2"):
                with self.subTest(role=role, requested=requested):
                    with self.assertRaises(TenantBoundaryError):
                        resolve_write_tenant_id(_user(role, 2), requested)

    def test_invalid_caller_ai_never_resolves_a_write_tenant(self):
        for role in (1, 6):
            for ai in (None, False, 0, -1, 2.5, "2"):
                with self.subTest(role=role, ai=ai):
                    with self.assertRaises(TenantBoundaryError):
                        resolve_write_tenant_id(_user(role, ai))

class ServiceCallerTests(TestCase):
    def test_service_caller_is_not_treated_as_user(self):
        # Service callers are represented by None; the policy layer requires a CurrentUser.
        with self.assertRaises((TypeError, AttributeError)):
            authorize_record_access(None, 2)
