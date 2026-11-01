from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException, Request

from ...models.provider import ProviderError
from ...service.factory import ProviderConfigError
from ...store.providers import (
    ProviderRecord,
    create_provider,
    delete_provider,
    get_provider,
    list_providers,
    set_provider_key,
    update_provider,
)
from ...store.runs import count_runs_for_provider
from ..schemas import (
    ProviderCreate,
    ProviderKeyUpdate,
    ProviderOut,
    ProviderUpdate,
)

router = APIRouter(prefix="/api/providers", tags=["providers"])


def _configured(request: Request, record: ProviderRecord) -> bool:
    env = request.app.state.env
    values = os.environ if env is None else env
    return bool(record.api_key) or bool(values.get(record.api_key_ref))


def _out(request: Request, record: ProviderRecord) -> ProviderOut:
    return ProviderOut(
        id=record.id,
        name=record.name,
        base_url=record.base_url,
        model=record.model,
        api_key_ref=record.api_key_ref,
        params=record.params,
        key_configured=_configured(request, record),
        key_stored=bool(record.api_key),
        created_at=record.created_at,
    )


@router.post("", response_model=ProviderOut, status_code=201)
def create(payload: ProviderCreate, request: Request) -> ProviderOut:
    if not payload.base_url.startswith(("http://", "https://")):
        raise HTTPException(400, "base_url must be http(s)")
    ref = payload.api_key_ref.strip()
    key = payload.api_key or None
    if not ref and not key:
        raise HTTPException(400, "api_key or api_key_ref is required")
    record = create_provider(
        request.app.state.db,
        name=payload.name,
        base_url=payload.base_url,
        model=payload.model,
        api_key_ref=ref,
        api_key=key,
        params=payload.params,
    )
    return _out(request, record)


@router.get("", response_model=list[ProviderOut])
def list_all(request: Request) -> list[ProviderOut]:
    return [
        _out(request, record)
        for record in list_providers(request.app.state.db)
    ]


@router.put("/{provider_id}", response_model=ProviderOut)
def update(provider_id: str, payload: ProviderUpdate, request: Request) -> ProviderOut:
    if not payload.base_url.startswith(("http://", "https://")):
        raise HTTPException(400, "base_url must be http(s)")
    record = update_provider(
        request.app.state.db,
        provider_id,
        name=payload.name,
        base_url=payload.base_url,
        model=payload.model,
        api_key_ref=payload.api_key_ref.strip(),
        params=payload.params,
    )
    if record is None:
        raise HTTPException(404, "provider not found")
    return _out(request, record)


@router.delete("/{provider_id}", status_code=204)
def remove(provider_id: str, request: Request) -> None:
    db = request.app.state.db
    if get_provider(db, provider_id) is None:
        raise HTTPException(404, "provider not found")
    count = count_runs_for_provider(db, provider_id)
    if count > 0:
        raise HTTPException(
            409,
            f"该模型已有 {count} 条 run 记录，无法删除；"
            "删除会破坏历史 run 的展示，请先处理相关 run。",
        )
    delete_provider(db, provider_id)


@router.put("/{provider_id}/key", response_model=ProviderOut)
def put_key(
    provider_id: str, payload: ProviderKeyUpdate, request: Request
) -> ProviderOut:
    record = set_provider_key(
        request.app.state.db, provider_id, payload.api_key
    )
    if record is None:
        raise HTTPException(404, "provider not found")
    return _out(request, record)


@router.delete("/{provider_id}/key", response_model=ProviderOut)
def delete_key(provider_id: str, request: Request) -> ProviderOut:
    record = set_provider_key(request.app.state.db, provider_id, None)
    if record is None:
        raise HTTPException(404, "provider not found")
    return _out(request, record)


@router.post("/{provider_id}/probe")
async def probe(provider_id: str, request: Request) -> dict:
    record = get_provider(request.app.state.db, provider_id)
    if record is None:
        raise HTTPException(404, "provider not found")
    adapter = None
    try:
        adapter = request.app.state.provider_factory(record)
        tool_calling = await adapter.probe_tools()
    except ProviderConfigError as exc:
        raise HTTPException(400, str(exc)) from exc
    except ProviderError as exc:
        raise HTTPException(
            502, {"kind": exc.kind, "message": str(exc)}
        ) from exc
    finally:
        close = getattr(adapter, "close", None)
        if close is not None:
            await close()
    return {"ok": True, "tool_calling": tool_calling}
