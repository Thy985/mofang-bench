from dataclasses import dataclass
from pathlib import Path

from mofang.api.events import RunEventBus
from mofang.models.provider import FakeProvider, ModelTurn
from mofang.service.runs import RunService
from mofang.store.db import Database
from mofang.store.providers import ProviderRecord, get_provider
from mofang.store.runs import get_run

from test_runs_service import seed_run, solver_factory


class DowngradingAdapter:
    downgraded = True

    async def chat(self, messages, tools, params):
        from mofang.models.provider import ModelTurn

        return ModelTurn(content=None)

    async def probe_tools(self) -> bool:
        return True


class MaxTokensDowngradingAdapter:
    max_tokens_downgraded = True

    async def chat(self, messages, tools, params):
        return ModelTurn(content=None)

    async def probe_tools(self) -> bool:
        return True


@dataclass
class ServiceEnv:
    db: Database
    service: RunService
    run_id: str
    provider: ProviderRecord


def _build_service_env(tmp_path: Path, provider_factory) -> ServiceEnv:
    # 复用 tests/service/test_runs_service.py 的 run 测试基座（db/benchmark/run 种子与 solver 工厂），
    # 仅把 provider_factory 换成测试所需的自定义 adapter。
    db, run_id = seed_run(tmp_path)
    run = get_run(db, run_id)
    provider = get_provider(db, run["provider_id"])
    service = RunService(
        db,
        RunEventBus(),
        provider_factory=provider_factory,
        solver_factory=solver_factory,
    )
    service.start(run_id)
    return ServiceEnv(db=db, service=service, run_id=run_id, provider=provider)


async def test_downgrade_persisted_to_provider_params(tmp_path: Path) -> None:
    env = _build_service_env(tmp_path, lambda record: DowngradingAdapter())
    await env.service.wait(env.run_id)
    record = get_provider(env.db, env.provider.id)
    assert record.params["stream"] is False


async def test_no_downgrade_keeps_params(tmp_path: Path) -> None:
    env = _build_service_env(
        tmp_path, lambda record: FakeProvider([ModelTurn(content=None)])
    )
    await env.service.wait(env.run_id)
    record = get_provider(env.db, env.provider.id)
    assert "stream" not in record.params


async def test_max_tokens_downgrade_persisted_to_provider_params(
    tmp_path: Path,
) -> None:
    env = _build_service_env(
        tmp_path, lambda record: MaxTokensDowngradingAdapter()
    )
    await env.service.wait(env.run_id)
    record = get_provider(env.db, env.provider.id)
    assert record.params["max_tokens"] == 8192
