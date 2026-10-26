from __future__ import annotations

import os

from fastapi import APIRouter, HTTPException, Request

from ...models.provider import ProviderError
from ...service.factory import ProviderConfigError
from ...store.providers import (
    ProviderRecord,
    create_provider,
    get_provider,
    list_providers,
)
from ..schemas import ProviderCreate, ProviderOut

router = APIRouter(prefix="/api/providers", tags=["providers"])


def _configured(request: Request, ref: str) -> bool:
    env = request.app.state.env
    values = os.environ if env is None else env
    return bool(values.get(ref))


def _out(request: Request, record: ProviderRecord) -> ProviderOut:
    return ProviderOut(
        id=record.id,
        name=record.name,
        base_url=record.base_url,
        model=record.model,
        api_key_ref=record.api_key_ref,
        params=record.params,
        key_configured=_configured(request, record.api_key_ref),
        created_at=record.created_at,
    )


@router.post("", response_model=ProviderOut, status_code=201)
def create(payload: ProviderCreate, request: Request) -> ProviderOut:
    if not payload.base_url.startswith(("http://", "https://")):
        raise HTTPException(400, "base_url must be http(s)")
    record = create_provider(
        request.app.state.db,
        name=payload.name,
        base_url=payload.base_url,
        model=payload.model,
        api_key_ref=payload.api_key_ref,
        params=payload.params,
    )
    return _out(request, record)


@router.get("", response_model=list[ProviderOut])
def list_all(request: Request) -> list[ProviderOut]:
    return [
        _out(request, record)
        for record in list_providers(request.app.state.db)
    ]


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
