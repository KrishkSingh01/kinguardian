"""Compile notification-related D1 statements against the applied local schema."""

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
        *(ROOT / "functions" / "api" / "notifications").glob("*.js"),
        ROOT / "functions" / "api" / "sos" / "index.js",
        ROOT / "functions" / "api" / "sos" / "[alert_id]" / "acknowledge.js",
        ROOT / "functions" / "api" / "invitations" / "accept.js",
        ROOT / "functions" / "api" / "auth" / "password.js",
        ROOT / "worker" / "scheduled-checkins.js",
        ROOT / "worker" / "push-delivery.js",
    ]
    statements_checked = 0
    pattern = re.compile(r"\.prepare\(\s*`(.*?)`\s*\)", re.DOTALL)
    for source_path in files:
        source = source_path.read_text(encoding="utf-8")
        for match in pattern.finditer(source):
            statement = match.group(1).strip()
            if "${" in statement:
                raise AssertionError(f"Unexpected interpolated SQL in {source_path.relative_to(ROOT)}")
            parameter_count = statement.count("?")
            try:
                connection.execute("EXPLAIN " + statement, (None,) * parameter_count)
            except sqlite3.Error as error:
                line = source.count("\n", 0, match.start()) + 1
                raise AssertionError(
                    f"Invalid SQL in {source_path.relative_to(ROOT)}:{line}: {error}\n{statement}"
                ) from error
            statements_checked += 1

    if statements_checked < 30:
        raise AssertionError(f"Expected to validate notification D1 statements, found {statements_checked}")
    print(f"PASS: {statements_checked} notification and event D1 statements compile against all numbered migrations.")


if __name__ == "__main__":
    main()
