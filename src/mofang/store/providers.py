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
    api_key: str | None = None

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
        api_key=row["api_key"],
    )


def create_provider(
    db: Database,
    *,
    name: str,
    base_url: str,
    model: str,
    api_key_ref: str,
    api_key: str | None = None,
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
        api_key=api_key,
    )
    with db.transaction() as conn:
        conn.execute(
            """
            INSERT INTO providers
              (id, name, base_url, model, api_key_ref, api_key,
               params_json, created_at)
            VALUES (?,?,?,?,?,?,?,?)
            """,
            (
                record.id,
                record.name,
                record.base_url,
                record.model,
                record.api_key_ref,
                record.api_key,
                record.params_json,
                record.created_at,
            ),
        )
    return record


def set_provider_key(
    db: Database, provider_id: str, api_key: str | None
) -> ProviderRecord | None:
    with db.transaction() as conn:
        cursor = conn.execute(
            "UPDATE providers SET api_key = ? WHERE id = ?",
            (api_key, provider_id),
        )
    if cursor.rowcount == 0:
        return None
    return get_provider(db, provider_id)


def update_provider(
    db: Database,
    provider_id: str,
    *,
    name: str,
    base_url: str,
    model: str,
    api_key_ref: str,
    params: dict[str, Any] | None = None,
) -> ProviderRecord | None:
    # params 做浅合并而非整体替换：表单只暴露 temperature/max_tokens/extra，
    # run 自动降级写入的 stream / retry_delay 等内部键要保留，避免一次编辑
    # 把降级设置悄悄抹掉（否则每次 run 都要重新触发 4xx 降级）。
    existing = get_provider(db, provider_id)
    if existing is None:
        return None
    merged = dict(existing.params)
    merged.update(params or {})
    with db.transaction() as conn:
        cursor = conn.execute(
            """
            UPDATE providers
            SET name = ?, base_url = ?, model = ?, api_key_ref = ?,
                params_json = ?
            WHERE id = ?
            """,
            (
                name,
                base_url.rstrip("/"),
                model,
                api_key_ref,
                json.dumps(merged, ensure_ascii=False),
                provider_id,
            ),
        )
    if cursor.rowcount == 0:
        return None
    return get_provider(db, provider_id)


def delete_provider(db: Database, provider_id: str) -> bool:
    with db.transaction() as conn:
        cursor = conn.execute(
            "DELETE FROM providers WHERE id = ?", (provider_id,)
        )
    return cursor.rowcount > 0


def set_provider_param(
    db: Database, provider_id: str, key: str, value: Any
) -> ProviderRecord | None:
    record = get_provider(db, provider_id)
    if record is None:
        return None
    params = record.params
    params[key] = value
    with db.transaction() as conn:
        conn.execute(
            "UPDATE providers SET params_json = ? WHERE id = ?",
            (json.dumps(params, ensure_ascii=False), provider_id),
        )
    return get_provider(db, provider_id)


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
