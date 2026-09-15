import os
import re
import sys
import unittest
from uuid import uuid4

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class Migration023StaticTests(unittest.TestCase):
    @staticmethod
    def _load_migration() -> str:
        root = os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )
        path = os.path.join(
            root,
            "src",
            "lib",
            "migrations",
            "023_deedly_manual_party_sources.sql",
        )
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def test_migration_file_exists(self):
        self.assertIn("023", self._load_migration())

    def test_transactional(self):
        sql = self._load_migration().upper()
        self.assertIn("BEGIN", sql)
        self.assertIn("COMMIT", sql)

    def test_targets_transfers_schema(self):
        sql = self._load_migration()
        self.assertIn("SET LOCAL search_path TO transfers, public", sql)

    def test_adds_party_source_with_golden_record_default(self):
        sql = self._load_migration().lower()
        self.assertIn("party_source", sql)
        # Existing rows are all GR-linked; the default preserves them.
        self.assertIn("default 'golden_record'", sql)

    def test_golden_record_id_becomes_nullable(self):
        sql = self._load_migration().lower()
        self.assertIn("alter column golden_record_id drop not null", sql)

    def test_manual_columns_include_identifier_type_and_country(self):
        sql = self._load_migration().lower()
        for column in (
            "manual_name",
            "manual_id_number",
            "manual_id_type",
            "manual_passport_country",
            "manual_email",
            "manual_phone",
            "manual_address",
        ):
            self.assertIn(column, sql)

    def test_source_fields_check_separates_sources(self):
        sql = self._load_migration().lower()
        self.assertIn("transfer_parties_source_fields_check", sql)
        # GR rows must carry a record id and no manual fields.
        self.assertIn("party_source = 'golden_record'", sql)
        self.assertIn("golden_record_id is not null", sql)
        # Manual rows are person-only with no GR id.
        self.assertIn("party_source = 'manual'", sql)
        self.assertIn("entity_type = 'person'", sql)
        self.assertIn("golden_record_id is null", sql)

    def test_no_manual_identity_uniqueness_index(self):
        # Duplicate warnings are advisory; identity dedup is not enforced.
        sql = self._load_migration().lower()
        for match in re.finditer(r"create\s+unique\s+index[^\n]*", sql):
            statement = match.group(0)
            self.assertNotIn("manual_", statement)
            self.assertNotIn("id_number", statement)

    def test_scoped_request_idempotency_on_both_tables(self):
        sql = self._load_migration().lower()
        self.assertIn("uq_transfer_parties_client_request", sql)
        self.assertIn("uq_transfers_client_request", sql)
        # Both indexes scope the key by accountable_institution_id so a foreign
        # institution's key can neither observe nor collide with a request.
        self.assertIn(
            "on transfer_parties (accountable_institution_id, client_request_id)", sql
        )
        self.assertIn(
            "on transfers (accountable_institution_id, client_request_id)", sql
        )
        # Partial indexes only — unrelated rows stay unaffected.
        self.assertIn("where client_request_id is not null", sql)

    def test_no_identifier_exclusivity_or_mandatory_identifier(self):
        sql = self._load_migration().lower()
        # No CHECK may require manual_id_number.
        self.assertNotIn("manual_id_number is not null", sql)

    def test_does_not_touch_gr_link_uniqueness(self):
        # The existing UNIQUE (transfer_id, golden_record_id, role) must not be
        # dropped or altered by this migration.
        sql = self._load_migration().lower()
        self.assertNotIn("drop constraint", sql)
        self.assertNotIn("drop index", sql)


MIGRATION_OPT_IN = "RUN_MIGRATION_CHAIN_TESTS"
MIGRATION_DSN_ENV = "TEST_MIGRATION_DATABASE_URL"


@unittest.skipUnless(
    os.getenv(MIGRATION_OPT_IN) == "1" and os.getenv(MIGRATION_DSN_ENV),
    f"Requires {MIGRATION_OPT_IN}=1 and {MIGRATION_DSN_ENV} pointing at a "
    "dedicated EMPTY PostgreSQL database (never TEST_DATABASE_URL)",
)
class Migration023DbIntegrationTests(unittest.IsolatedAsyncioTestCase):
    """Applies the real migration chain 001..023 on a dedicated empty database.

    Execution requirement (separate from the approved isolated scratch-schema
    DSN): an empty PostgreSQL 13+ database reachable via
    TEST_MIGRATION_DATABASE_URL, with CREATE/DROP SCHEMA privileges. The class
    refuses to run if any table already exists in the public or transfers
    schemas, so it can never run against a populated database. This test was
    prepared but not executed: no such empty database has been provisioned.
    """

    async def asyncSetUp(self) -> None:
        import asyncpg

        self._asyncpg = asyncpg
        self.conn = await asyncpg.connect(
            os.environ[MIGRATION_DSN_ENV], command_timeout=60
        )
        self._applied: list[str] = []
        self.addAsyncCleanup(self._cleanup)
        # Hard precondition: the database must contain no application tables.
        # This fails loudly rather than skipping so the test cannot silently
        # target a populated database.
        existing = await self.conn.fetchval(
            """
            SELECT count(*) FROM information_schema.tables
            WHERE table_schema IN ('public', 'transfers')
            """
        )
        if existing:
            raise AssertionError(
                f"{MIGRATION_DSN_ENV} is not empty ({existing} tables in "
                "public/transfers): the migration chain test requires a "
                "dedicated empty database"
            )

    async def _cleanup(self) -> None:
        try:
            if self._applied:
                await self.conn.execute("DROP SCHEMA IF EXISTS transfers CASCADE")
                await self.conn.execute("DROP SCHEMA IF EXISTS public CASCADE")
                await self.conn.execute("CREATE SCHEMA public")
        finally:
            await self.conn.close()

    @staticmethod
    def _migrations_dir() -> str:
        root = os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )
        return os.path.join(root, "src", "lib", "migrations")

    def _migration_files(self, upto: int = 999) -> list[str]:
        files = sorted(
            f
            for f in os.listdir(self._migrations_dir())
            if re.match(r"^\d{3}_", f) and f.endswith(".sql")
        )
        return [f for f in files if int(f[:3]) <= upto]

    async def _apply(self, filename: str) -> None:
        with open(
            os.path.join(self._migrations_dir(), filename), encoding="utf-8"
        ) as f:
            # Migration files carry their own BEGIN/COMMIT; asyncpg executes
            # the whole script on the simple protocol.
            await self.conn.execute(f.read())
        self._applied.append(filename)

    async def _apply_chain_through_021(self) -> None:
        for f in self._migration_files(upto=21):
            await self._apply(f)

    async def _apply_chain_through_023(self) -> None:
        for f in self._migration_files():
            await self._apply(f)

    async def _insert_transfer(self, ai: int = 5, key=None):
        return await self.conn.fetchval(
            """
            INSERT INTO transfers.transfers
              (transfer_id, property_address, purchase_price, status,
               accountable_institution_id, client_request_id, request_fingerprint)
            VALUES ($1, '1 Chain St', 500000, 'in_progress', $2, $3, 'fp')
            RETURNING id
            """,
            f"TRF-{uuid4().hex[:8]}", ai, key,
        )

    async def _seed_pre023_gr_party(self):
        """Insert a GR-linked party under the pre-023 shape (no idempotency
        columns exist on transfers yet)."""
        tid = await self.conn.fetchval(
            """
            INSERT INTO transfers.transfers
              (transfer_id, property_address, purchase_price, status,
               accountable_institution_id)
            VALUES ($1, '1 Chain St', 500000, 'in_progress', 5)
            RETURNING id
            """,
            f"TRF-{uuid4().hex[:8]}",
        )
        return await self.conn.fetchval(
            """
            INSERT INTO transfers.transfer_parties
              (transfer_id, golden_record_id, entity_type, role,
               accountable_institution_id)
            VALUES ($1, $2, 'person', 'transferor', 5)
            RETURNING id
            """,
            tid, uuid4(),
        )

    async def test_chain_applies_and_backfills_existing_gr_rows(self) -> None:
        await self._apply_chain_through_021()
        party_id = await self._seed_pre023_gr_party()
        await self._apply("023_deedly_manual_party_sources.sql")
        row = await self.conn.fetchrow(
            "SELECT party_source, golden_record_id FROM transfers.transfer_parties WHERE id = $1",
            party_id,
        )
        self.assertEqual(row["party_source"], "golden_record")
        self.assertIsNotNone(row["golden_record_id"])

    async def test_source_fields_check_rejects_mixed_shapes(self) -> None:
        await self._apply_chain_through_023()
        tid = await self._insert_transfer()
        asyncpg = self._asyncpg

        async def insert_party(**cols):
            defaults = dict(
                transfer_id=tid, golden_record_id=None, entity_type="person",
                role="transferor", accountable_institution_id=5,
                party_source="manual", manual_name=None,
            )
            defaults.update(cols)
            return await self.conn.fetchval(
                """
                INSERT INTO transfers.transfer_parties
                  (transfer_id, golden_record_id, entity_type, role,
                   accountable_institution_id, party_source, manual_name)
                VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
                """,
                defaults["transfer_id"], defaults["golden_record_id"],
                defaults["entity_type"], defaults["role"],
                defaults["accountable_institution_id"],
                defaults["party_source"], defaults["manual_name"],
            )

        with self.assertRaises(asyncpg.CheckViolationError):
            await insert_party(golden_record_id=uuid4(), manual_name="Mixed")
        with self.assertRaises(asyncpg.CheckViolationError):
            await insert_party(party_source="golden_record")  # no GR id
        with self.assertRaises(asyncpg.CheckViolationError):
            await insert_party(
                party_source="golden_record",
                golden_record_id=uuid4(),
                manual_name="Mixed",
            )
        with self.assertRaises(asyncpg.CheckViolationError):
            await insert_party(entity_type="company", manual_name="Corp")
        # A well-formed manual person and a well-formed GR link both succeed.
        manual_id = await insert_party(manual_name="Valid Person")
        gr_id = await insert_party(
            party_source="golden_record", golden_record_id=uuid4(), role="transferee"
        )
        self.assertIsNotNone(manual_id)
        self.assertIsNotNone(gr_id)

    async def test_scoped_idempotency_indexes_enforce_and_isolate(self) -> None:
        await self._apply_chain_through_023()
        key = uuid4()
        tid5 = await self._insert_transfer(ai=5)
        tid7 = await self._insert_transfer(ai=7)

        async def insert_manual(tid, ai, request_key):
            return await self.conn.fetchval(
                """
                INSERT INTO transfers.transfer_parties
                  (transfer_id, entity_type, role, accountable_institution_id,
                   party_source, manual_name, client_request_id, request_fingerprint)
                VALUES ($1, 'person', 'transferor', $2, 'manual', 'P', $3, 'fp')
                RETURNING id
                """,
                tid, ai, request_key,
            )

        await insert_manual(tid5, 5, key)
        with self.assertRaises(self._asyncpg.UniqueViolationError):
            await insert_manual(tid5, 5, key)
        # The same key under a foreign institution is an independent request.
        other = await insert_manual(tid7, 7, key)
        self.assertIsNotNone(other)

        # Same scope on transfers itself.
        await self._insert_transfer(ai=5, key=key)
        with self.assertRaises(self._asyncpg.UniqueViolationError):
            await self._insert_transfer(ai=5, key=key)
        self.assertIsNotNone(await self._insert_transfer(ai=7, key=key))

    async def test_gr_link_uniqueness_and_manual_duplicates_allowed(self) -> None:
        await self._apply_chain_through_023()
        tid = await self._insert_transfer()
        gr = uuid4()
        await self.conn.execute(
            """
            INSERT INTO transfers.transfer_parties
              (transfer_id, golden_record_id, entity_type, role,
               accountable_institution_id, party_source)
            VALUES ($1, $2, 'person', 'transferor', 5, 'golden_record')
            """,
            tid, gr,
        )
        with self.assertRaises(self._asyncpg.UniqueViolationError):
            await self.conn.execute(
                """
                INSERT INTO transfers.transfer_parties
                  (transfer_id, golden_record_id, entity_type, role,
                   accountable_institution_id, party_source)
                VALUES ($1, $2, 'person', 'transferor', 5, 'golden_record')
                """,
                tid, gr,
            )
        # Two manual parties in the same role are permitted: duplicate
        # warnings are advisory, never a uniqueness constraint.
        for _ in range(2):
            await self.conn.execute(
                """
                INSERT INTO transfers.transfer_parties
                  (transfer_id, entity_type, role, accountable_institution_id,
                   party_source, manual_name)
                VALUES ($1, 'person', 'transferee', 5, 'manual', 'Dup')
                """,
                tid,
            )

    async def test_migration_023_is_rerunnable(self) -> None:
        await self._apply_chain_through_023()
        await self._apply("023_deedly_manual_party_sources.sql")
        cols = await self.conn.fetch(
            """
            SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'transfers' AND table_name = 'transfer_parties'
            """
        )
        self.assertIn("party_source", {r["column_name"] for r in cols})


if __name__ == "__main__":
    unittest.main()
