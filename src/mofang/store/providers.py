from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from .db import Database


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True)
class ProviderRecord:
    id: str
    name: str
    base_url: str
    model: str
    api_key_ref: str
    params_json: str
    created_at: str

    @property
    def params(self) -> dict[str, Any]:
        return json.loads(self.params_json)


def _row_to_record(row: Any) -> ProviderRecord:
    return ProviderRecord(
        id=row["id"],
        name=row["name"],
        base_url=row["base_url"],
        model=row["model"],
        api_key_ref=row["api_key_ref"],
        params_json=row["params_json"],
        created_at=row["created_at"],
    )


def create_provider(
    db: Database,
    *,
    name: str,
    base_url: str,
    model: str,
    api_key_ref: str,
    params: dict[str, Any] | None = None,
) -> ProviderRecord:
    record = ProviderRecord(
        id=uuid.uuid4().hex,
        name=name,
        base_url=base_url.rstrip("/"),
        model=model,
        api_key_ref=api_key_ref,
        params_json=json.dumps(params or {}, ensure_ascii=False),
        created_at=now(),
    )
    with db.transaction() as conn:
        conn.execute(
            "INSERT INTO providers VALUES (?,?,?,?,?,?,?)",
            (
                record.id,
                record.name,
                record.base_url,
                record.model,
                record.api_key_ref,
                record.params_json,
                record.created_at,
            ),
        )
    return record


def list_providers(db: Database) -> list[ProviderRecord]:
    conn = db.connect()
    try:
        rows = conn.execute(
            "SELECT * FROM providers ORDER BY created_at, id"
        ).fetchall()
    finally:
        conn.close()
    return [_row_to_record(row) for row in rows]


def get_provider(db: Database, provider_id: str) -> ProviderRecord | None:
    conn = db.connect()
    try:
        row = conn.execute(
            "SELECT * FROM providers WHERE id = ?", (provider_id,)
        ).fetchone()
    finally:
        conn.close()
    return _row_to_record(row) if row else None
