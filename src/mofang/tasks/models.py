from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field


class Task(BaseModel):
    id: str
    cube: Literal["2x2", "3x3"]
    scramble: list[str]
    scramble_depth: int
    state: dict[str, Any]
    reference_length: int
    reference_kind: Literal["exact", "near_optimal", "fake"]
    bin: str


class Benchmark(BaseModel):
    id: str
    name: str
    version: str = "v1"
    cube: Literal["2x2", "3x3"]
    kind: Literal["frozen", "random"] = "frozen"
    tasks: list[Task]
    content_hash: str = ""
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def compute_hash(self) -> str:
        payload = self.model_dump(exclude={"content_hash", "created_at"})
        raw = json.dumps(
            payload, sort_keys=True, ensure_ascii=False, separators=(",", ":")
        ).encode("utf-8")
        return hashlib.sha256(raw).hexdigest()

    def save(self, path: Path) -> None:
        self.content_hash = self.compute_hash()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(self.model_dump(), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    @classmethod
    def load(cls, path: Path) -> "Benchmark":
        return cls.model_validate_json(path.read_text(encoding="utf-8"))
