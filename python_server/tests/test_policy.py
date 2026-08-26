import uuid
from unittest import TestCase

from auth.current_user import CurrentUser
from auth.policy import (
    AuthorizationDecision,
    TenantBoundaryError,
    authorize_mutation,
    authorize_record_access,
    is_cross_tenant,
    resolve_effective_tenant_id,
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


class CrossTenantRoleTests(TestCase):
    def test_role_1_is_cross_tenant(self):
        self.assertTrue(is_cross_tenant(_user(1, 2)))

    def test_role_6_is_cross_tenant(self):
        self.assertTrue(is_cross_tenant(_user(6, 2)))

    def test_role_2_is_not_cross_tenant(self):
        self.assertFalse(is_cross_tenant(_user(2, 2)))

    def test_role_3_is_not_cross_tenant(self):
        self.assertFalse(is_cross_tenant(_user(3, 2)))

    def test_role_4_is_not_cross_tenant(self):
        self.assertFalse(is_cross_tenant(_user(4, 2)))

    def test_role_5_is_not_cross_tenant(self):
        self.assertFalse(is_cross_tenant(_user(5, 2)))


class TenantResolutionTests(TestCase):
    def test_cross_tenant_may_select_other_ai(self):
        user = _user(1, 2)
        self.assertEqual(resolve_effective_tenant_id(user, 99), 99)

    def test_cross_tenant_defaults_to_own_ai(self):
        user = _user(6, 2)
        self.assertEqual(resolve_effective_tenant_id(user), 2)

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
    def test_super_admin_allowed_any_tenant(self):
        user = _user(1, 2)
        self.assertEqual(
            authorize_record_access(user, 99), AuthorizationDecision.ALLOWED
        )

    def test_admin_agent_allowed_any_tenant(self):
        user = _user(6, 2)
        self.assertEqual(
            authorize_record_access(user, 99), AuthorizationDecision.ALLOWED
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

    def test_no_undocumented_role_cross_tenant(self):
        for role in (2, 3, 4, 5):
            with self.subTest(role=role):
                user = _user(role, 2)
                # Only roles 1 and 6 reach the same-tenant path if AI differs;
                # for roles 2/3/5, foreign tenant must be NOT_FOUND.
                self.assertEqual(
                    authorize_record_access(user, 99),
                    AuthorizationDecision.NOT_FOUND,
                )


class ServiceCallerTests(TestCase):
    def test_service_caller_is_not_treated_as_user(self):
        # Service callers are represented by None; the policy layer requires a CurrentUser.
        with self.assertRaises((TypeError, AttributeError)):
            authorize_record_access(None, 2)
