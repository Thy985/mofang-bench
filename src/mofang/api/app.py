from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Callable

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ..cube.solver import ReferenceSolver
from ..models.provider import ProviderAdapter
from ..service.factory import build_adapter, make_solver_factory
from ..service.runs import RunService
from ..store.db import Database
from ..store.providers import ProviderRecord
from ..store.runs import mark_running_interrupted
from .events import RunEventBus
from .routes import benchmarks, providers
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
    service = RunService(database, events, pfactory, sfactory)

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
    return app
