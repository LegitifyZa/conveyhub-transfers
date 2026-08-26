import os
import re
import unittest


class PlatformUserActorColumnsMigrationTests(unittest.TestCase):
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
            "013_add_platform_user_actor_columns.sql",
        )
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def _load_prior_migrations(self) -> str:
        root = os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )
        migrations_dir = os.path.join(root, "src", "lib", "migrations")
        prior_files = [
            f
            for f in os.listdir(migrations_dir)
            if f.endswith(".sql") and f < "013_add_platform_user_actor_columns.sql"
        ]
        prior_files.sort()
        contents = []
        for f in prior_files:
            with open(
                os.path.join(migrations_dir, f), "r", encoding="utf-8"
            ) as fh:
                contents.append(fh.read())
        return "".join(contents)

    def test_migration_file_exists(self):
        sql = self._load_migration()
        self.assertIn("013", sql)
        self.assertIn("platform_user_actor_columns", sql)

    def test_targets_lowercase_transfers_schema(self):
        sql = self._load_migration()
        self.assertIn("SET LOCAL search_path TO transfers, public", sql)
        self.assertNotIn('"Transfers"', sql)

    def test_all_six_expected_columns_added(self):
        sql = self._load_migration().lower()
        expected = [
            "matters.assigned_to_user_id",
            "matters.created_by_user_id",
            "transfers.submitted_by_user_id",
            "matter_milestones.assigned_to_user_id",
            "milestone_history.changed_by_user_id",
            "transfer_documents.uploaded_by_user_id",
        ]
        pattern = re.compile(
            r"alter\s+table\s+(?:transfers\.)?(\w+)\s+add\s+column\s+if\s+not\s+exists\s+(\w+)\s+integer",
            re.IGNORECASE,
        )
        found = {f"{table}.{col}" for table, col in pattern.findall(sql)}
        self.assertEqual(sorted(found), sorted(expected))

    def test_each_column_is_nullable(self):
        sql = self._load_migration()
        pattern = re.compile(
            r"alter\s+table\s+(?:transfers\.)?(\w+)\s+add\s+column\s+if\s+not\s+exists\s+(\w+)\s+integer[^;]*",
            re.IGNORECASE,
        )
        matches = list(pattern.finditer(sql))
        self.assertEqual(len(matches), 6)
        for match in matches:
            table = match.group(1)
            col = match.group(2)
            statement = match.group(0)
            with self.subTest(table=table, col=col):
                self.assertNotIn("NOT NULL", statement.upper())

    def test_no_foreign_keys_to_public_users(self):
        sql = self._load_migration().upper()
        self.assertNotIn("REFERENCES", sql)
        self.assertNotIn("FOREIGN KEY", sql)
        self.assertNotIn("REFERENCES USERS", sql)

    def test_no_local_users_table_created(self):
        sql = self._load_migration().upper()
        self.assertNotIn("CREATE TABLE", sql)

    def test_existing_uuid_actor_columns_not_dropped_or_altered(self):
        sql = self._load_migration().upper()
        self.assertNotIn("DROP COLUMN", sql)
        self.assertNotIn("ALTER COLUMN", sql)

    def test_existing_uuid_actor_columns_defined_in_prior_migrations(self):
        prior = self._load_prior_migrations()
        for col in (
            "assigned_to",
            "created_by",
            "submitted_by",
            "changed_by",
            "uploaded_by",
        ):
            self.assertIn(col, prior, f"original UUID actor column {col} missing")

    def test_no_actor_data_backfill(self):
        sql = self._load_migration().upper()
        # No UPDATE/INSERT means no fabricated UUID -> integer backfill.
        self.assertNotIn("UPDATE", sql)
        self.assertNotIn("INSERT INTO", sql)

    def test_no_tenant_or_ownership_changes(self):
        sql = self._load_migration().upper()
        self.assertNotIn("TENANT_ID", sql)
        self.assertNotIn("ACCOUNTABLE_INSTITUTION_ID", sql)

    def test_no_firm_or_public_users_touched(self):
        sql = self._load_migration().upper()
        self.assertNotIn("FIRMS", sql)
        # Comments may mention public.users; the migration itself must not act on it.
        self.assertNotIn("ALTER TABLE public.users", sql)
        self.assertNotIn("ALTER TABLE users", sql)

    def test_index_added_for_milestone_work_queues(self):
        sql = self._load_migration()
        self.assertIn(
            "CREATE INDEX IF NOT EXISTS idx_matter_milestones_assigned_to_user_id",
            sql,
        )

    def test_indexed_column_is_one_of_six_added(self):
        sql = self._load_migration()
        # The only index created should be on the work-queue column.
        pattern = re.compile(
            r"create\s+index\s+if\s+not\s+exists\s+\w+\s+on\s+(?:transfers\.)?\w+\s*\(\s*(\w+)\s*\)",
            re.IGNORECASE,
        )
        indexed = pattern.findall(sql)
        self.assertEqual(indexed, ["assigned_to_user_id"])

    def test_idempotent_on_fresh_and_existing_databases(self):
        sql = self._load_migration().upper()
        self.assertIn("ADD COLUMN IF NOT EXISTS", sql)
        self.assertIn("CREATE INDEX IF NOT EXISTS", sql)

    def test_migration_is_transactional(self):
        sql = self._load_migration().upper()
        self.assertIn("BEGIN", sql)
        self.assertIn("COMMIT", sql)


if __name__ == "__main__":
    unittest.main()
