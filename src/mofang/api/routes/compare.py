from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from ...eval.compare import compare_runs

router = APIRouter(prefix="/api/compare", tags=["compare"])


@router.get("")
def compare(run_ids: str, request: Request) -> dict:
    ids = [item.strip() for item in run_ids.split(",") if item.strip()]
    if len(ids) != 2:
        raise HTTPException(400, "exactly two run_ids required")
    try:
        return compare_runs(request.app.state.db, ids)
    except LookupError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
