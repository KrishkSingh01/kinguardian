"""Compile account setup, owner, and device-pairing SQL against the migrations."""

from pathlib import Path
import re
import sqlite3


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    connection = sqlite3.connect(":memory:")
    connection.execute("PRAGMA foreign_keys = ON")
    for migration in sorted((ROOT / "migrations").glob("*.sql")):
        connection.executescript(migration.read_text(encoding="utf-8"))

    files = [
        ROOT / "functions" / "api" / "owner" / "users" / "index.js",
        ROOT / "functions" / "api" / "owner" / "users" / "[user_id]" / "reset.js",
        ROOT / "functions" / "api" / "owner" / "users" / "[user_id]" / "status.js",
        ROOT / "functions" / "api" / "auth" / "setup-password.js",
        *(ROOT / "functions" / "api" / "device-pairing").glob("*.js"),
    ]
    pattern = re.compile(r"\.prepare\(\s*`(.*?)`\s*\)", re.DOTALL)
    checked = 0
    for source_path in files:
        source = source_path.read_text(encoding="utf-8")
        for match in pattern.finditer(source):
            sql = match.group(1).strip()
            if "${" in sql:
                raise AssertionError(f"Unexpected interpolated SQL in {source_path.relative_to(ROOT)}")
            try:
                connection.execute("EXPLAIN " + sql, (None,) * sql.count("?"))
            except sqlite3.Error as error:
                line = source.count("\n", 0, match.start()) + 1
                raise AssertionError(
                    f"Invalid SQL in {source_path.relative_to(ROOT)}:{line}: {error}\n{sql}"
                ) from error
            checked += 1

    if checked < 20:
        raise AssertionError(f"Expected to compile at least 20 account-security SQL statements, checked {checked}")
    print(f"PASS: {checked} account setup, owner-account, and device-pairing SQL statements compile against all migrations.")


if __name__ == "__main__":
    main()
