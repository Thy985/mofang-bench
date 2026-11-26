from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ProviderCreate(BaseModel):
    name: str = Field(min_length=1)
    base_url: str = Field(min_length=1)
    model: str = Field(min_length=1)
    api_key_ref: str = ""
    api_key: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)


class ProviderUpdate(BaseModel):
    name: str = Field(min_length=1)
    base_url: str = Field(min_length=1)
    model: str = Field(min_length=1)
    api_key_ref: str = ""
    params: dict[str, Any] = Field(default_factory=dict)


class ProviderKeyUpdate(BaseModel):
    api_key: str = Field(min_length=1)


class ProviderOut(BaseModel):
    id: str
    name: str
    base_url: str
    model: str
    api_key_ref: str
    params: dict[str, Any]
    key_configured: bool
    key_stored: bool
    created_at: str


class BenchmarkCreate(BaseModel):
    name: str = Field(min_length=1)
    cube: Literal["2x2", "3x3"]
    depths: list[int] = Field(default_factory=lambda: [1, 2, 3])
    per_depth: int = Field(default=2, ge=1)
    seed: int = 42
    solver: Literal["table", "rubik"] = "table"


class BenchmarkOut(BaseModel):
    id: str
    name: str
    version: str
    kind: str
    cube: str
    content_hash: str
    frozen_at: str
    task_count: int


class BenchmarkDetail(BenchmarkOut):
    tasks: list[dict[str, Any]]


class RunCreate(BaseModel):
    provider_id: str = ""
    benchmark_id: str
    tool_mode: Literal["both", "turn_only", "batch_only"] = "both"
    # 批量创建：为每个 provider 各建一个 run 并并行执行。
    # provider_ids 非空时优先于 provider_id（单选兼容字段）。
    provider_ids: list[str] = Field(default_factory=list)
    # 选题子集：benchmark 内的 task key 列表；None = 跑全集。
    task_keys: list[str] | None = None
    # 计划模式：要求 agent 先调用 submit_plan 提交目标与分阶段计划。
    require_plan: bool = False
    # 求解器辅助：off 不注册 solve 工具；assist 注册但只给建议、不自动执行。
    solver: Literal["off", "assist"] = "off"
    # 方法 pack：none 不注入；ortega 只对 2x2、lbl 只对 3x3；首版与 assist 互斥。
    skill: Literal["none", "ortega", "lbl"] = "none"
    params: dict[str, Any] = Field(default_factory=dict)
    budget: dict[str, Any] = Field(default_factory=dict)


class RunOut(BaseModel):
    id: str
    provider_id: str
    benchmark_id: str
    tool_mode: str
    budget: dict[str, Any]
    prompt_version: str
    status: str
    totals: dict[str, Any] | None
    error: str | None
    task_keys: list[str] | None = None
    require_plan: bool = False
    solver: Literal["off", "assist"] = "off"
    skill: str = "none"
    created_at: str
    started_at: str | None
    finished_at: str | None


class EpisodeOut(BaseModel):
    id: str
    run_id: str
    task_id: str
    task_key: str
    status: str
    solved: bool
    moves_used: int
    reference_length: int
    efficiency: float | None
    progress_ratio: float | None
    protocol_errors: int
    tokens_in: int | None
    tokens_out: int | None
    latency_ms: int | None
    failure_code: str | None
    error: str | None
    plan: dict[str, Any] | None = None
    solver: str = "off"
    skill: str = "none"
    started_at: str | None
    finished_at: str | None


class StepOut(BaseModel):
    id: str
    seq: int
    kind: str
    tool_name: str | None
    arguments: dict[str, Any] | None
    result: dict[str, Any] | None
    state: dict[str, Any] | None
    reference_length_after: int | None
