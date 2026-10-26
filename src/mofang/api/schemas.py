from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class ProviderCreate(BaseModel):
    name: str = Field(min_length=1)
    base_url: str = Field(min_length=1)
    model: str = Field(min_length=1)
    api_key_ref: str = Field(min_length=1)
    params: dict[str, Any] = Field(default_factory=dict)


class ProviderOut(BaseModel):
    id: str
    name: str
    base_url: str
    model: str
    api_key_ref: str
    params: dict[str, Any]
    key_configured: bool
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
    provider_id: str
    benchmark_id: str
    tool_mode: Literal["both", "turn_only", "batch_only"] = "both"
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
