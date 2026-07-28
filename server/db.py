from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


TERMINAL_SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS player_accounts (
    qq_id TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    must_change_password INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS web_sessions (
    session_hash TEXT PRIMARY KEY,
    qq_id TEXT NOT NULL,
    csrf_hash TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (qq_id) REFERENCES player_accounts(qq_id)
);

CREATE INDEX IF NOT EXISTS idx_web_sessions_qq ON web_sessions(qq_id);
CREATE INDEX IF NOT EXISTS idx_web_sessions_expiry ON web_sessions(expires_at);

CREATE TABLE IF NOT EXISTS drama_favorites (
    qq_id TEXT NOT NULL,
    drama_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (qq_id, drama_id)
);

CREATE TABLE IF NOT EXISTS user_avatars (
    qq_id TEXT PRIMARY KEY,
    file_key TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS idempotency_records (
    key TEXT NOT NULL,
    qq_id TEXT NOT NULL,
    action TEXT NOT NULL,
    response_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (key, qq_id, action)
);

CREATE TABLE IF NOT EXISTS web_audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    qq_id TEXT,
    action TEXT NOT NULL,
    target TEXT,
    result TEXT NOT NULL,
    ip TEXT,
    request_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    qq_id TEXT,
    ip TEXT,
    succeeded INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""


def connect(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(str(path), timeout=8, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout=8000")
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def init_terminal_db(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with connect(path) as connection:
        connection.executescript(TERMINAL_SCHEMA)


@contextmanager
def transaction(path: Path, immediate: bool = False) -> Iterator[sqlite3.Connection]:
    connection = connect(path)
    try:
        connection.execute("BEGIN IMMEDIATE" if immediate else "BEGIN")
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def json_object(value: object, default: dict | None = None) -> dict:
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(str(value or "{}"))
        return parsed if isinstance(parsed, dict) else (default or {})
    except (TypeError, ValueError, json.JSONDecodeError):
        return default or {}

