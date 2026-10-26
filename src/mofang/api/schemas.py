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
