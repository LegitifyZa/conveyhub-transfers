import os
import re
import unittest


class NoRuntimeDDLTests(unittest.TestCase):
    def test_database_initialization_does_not_execute_ddl(self):
        # python_server/tests/ -> python_server/ -> project root
        root = os.path.dirname(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        )
        path = os.path.join(root, "src", "lib", "database.ts")
        with open(path, "r", encoding="utf-8") as f:
            content = f.read()

        # Extract initializeDatabase body.
        match = re.search(
            r"export const initializeDatabase = async \(\): Promise<void> => \{(.*?)\n\}",
            content,
            re.DOTALL,
        )
        self.assertIsNotNone(match, "initializeDatabase function not found")
        body = match.group(1)

        for kw in (
            "CREATE SCHEMA",
            "CREATE TABLE",
            "CREATE INDEX",
            "ALTER TABLE",
            "DROP TABLE",
            "CREATE EXTENSION",
        ):
            self.assertNotIn(kw, body, f"initializeDatabase body contains {kw}")

        # createTables is the legacy runtime DDL helper and must not be invoked.
        self.assertNotIn("createTables", body)

        # The whole file should no longer contain any runtime DDL statements.
        for kw in ("CREATE SCHEMA", "CREATE TABLE", "CREATE INDEX", "ALTER TABLE"):
            self.assertNotIn(kw, content, f"database.ts contains {kw}")
