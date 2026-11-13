from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


RUN_COLUMNS = {
    "worker_id": "VARCHAR(120)",
    "lease_expires_at": "TIMESTAMP",
    "heartbeat_at": "TIMESTAMP",
    "attempt_count": "INTEGER DEFAULT 0 NOT NULL",
    "resume_action": "VARCHAR(60) DEFAULT '' NOT NULL",
    "last_error": "TEXT DEFAULT '' NOT NULL",
}
USER_COLUMNS = {
    "password_hash": "TEXT DEFAULT '' NOT NULL",
}
TOOL_COLUMNS = {
    "read_only": "BOOLEAN DEFAULT FALSE NOT NULL",
    "destructive": "BOOLEAN DEFAULT FALSE NOT NULL",
    "idempotent": "BOOLEAN DEFAULT FALSE NOT NULL",
    "mcp_server_id": "VARCHAR(36)",
    "remote_name": "VARCHAR(160)",
}


def ensure_schema(engine: Engine) -> None:
    """Apply small additive migrations for the self-hosted demo.

    Production deployments should replace this helper with Alembic.
    """
    with engine.begin() as connection:
        for table_name, column_definitions in (
            ("runs", RUN_COLUMNS),
            ("users", USER_COLUMNS),
            ("tools", TOOL_COLUMNS),
        ):
            if not inspect(connection).has_table(table_name):
                continue
            existing = {
                column["name"]
                for column in inspect(connection).get_columns(table_name)
            }
            for name, ddl in column_definitions.items():
                if name in existing:
                    continue
                if connection.dialect.name == "sqlite":
                    ddl = ddl.replace("TIMESTAMP", "DATETIME")
                connection.execute(
                    text(
                        f'ALTER TABLE "{table_name}" ADD COLUMN '
                        f'"{name}" {ddl}'
                    )
                )
