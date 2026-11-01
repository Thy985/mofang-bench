from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Callable

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from ..cube.solver import ReferenceSolver
from ..models.provider import ProviderAdapter
from ..service.factory import build_adapter, make_solver_factory
from ..service.runs import RunService
from ..store.db import Database
from ..store.providers import ProviderRecord
from ..store.runs import mark_running_interrupted
from .events import RunEventBus
from .routes import benchmarks, compare, episodes, providers, runs
from .settings import Settings


def create_app(
    settings: Settings | None = None,
    *,
    db: Database | None = None,
    provider_factory: Callable[[ProviderRecord], ProviderAdapter] | None = None,
    solver_factory: Callable[[str], ReferenceSolver] | None = None,
    env: dict[str, str] | None = None,
) -> FastAPI:
    resolved = settings or Settings.from_env()
    database = db or Database(resolved.db_path)
    events = RunEventBus()
    env_values = dict(os.environ) if env is None else dict(env)
    pfactory = provider_factory or (
        lambda record: build_adapter(record, env_values)
    )
    sfactory = solver_factory or make_solver_factory(resolved.table_path)
    service = RunService(
        database,
        events,
        pfactory,
        sfactory,
        max_parallel_episodes=resolved.max_parallel_episodes,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        database.initialize()
        mark_running_interrupted(database)
        yield

    app = FastAPI(title="mofang", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved.cors_origins),
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.settings = resolved
    app.state.db = database
    app.state.events = events
    app.state.service = service
    app.state.provider_factory = pfactory
    app.state.solver_factory = sfactory
    app.state.env = env_values
    app.include_router(providers.router)
    app.include_router(benchmarks.router)
    app.include_router(runs.router)
    app.include_router(episodes.router)
    app.include_router(compare.router)

    web_dir = resolved.web_dir
    if web_dir is not None and (web_dir / "index.html").is_file():
        assets = web_dir / "assets"
        if assets.is_dir():
            app.mount("/assets", StaticFiles(directory=assets), name="assets")

        root = web_dir.resolve()
        index = root / "index.html"

        # catch-all 必须晚于 API 路由注册，否则会遮住接口路径
        @app.get("/{full_path:path}", include_in_schema=False)
        def spa(full_path: str):
            if full_path == "api" or full_path.startswith("api/"):
                raise HTTPException(404, "not found")
            candidate = (root / full_path).resolve()
            # 百分号编码的 ../ 会原样到达这里，必须确认仍在 web_dir 内
            if candidate.is_relative_to(root) and candidate.is_file():
                return FileResponse(candidate)
            return FileResponse(index)
    return app
