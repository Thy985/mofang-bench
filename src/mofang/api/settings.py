from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping


@dataclass(frozen=True)
class Settings:
    db_path: Path = Path("data/mofang.db")
    table_path: Path = Path("data/cache/2x2_distances.pkl")
    web_dir: Path | None = Path("frontend/dist")
    host: str = "127.0.0.1"
    port: int = 8000
    # 所有 run 共享的 episode 并发额度上限：控制同时打向各 provider 的
    # LLM 请求总量。3x3 每 run 还会有一个 twophase 子进程，调大时留意内存。
    max_parallel_episodes: int = 3
    cors_origins: tuple[str, ...] = (
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    )

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        values = os.environ if env is None else env
        web_raw = values.get("MOFANG_WEB_DIR", "frontend/dist")
        return cls(
            db_path=Path(values.get("MOFANG_DB", "data/mofang.db")),
            table_path=Path(
                values.get("MOFANG_TABLE", "data/cache/2x2_distances.pkl")
            ),
            web_dir=Path(web_raw) if web_raw else None,
            host=values.get("MOFANG_HOST", "127.0.0.1"),
            port=int(values.get("MOFANG_PORT", "8000")),
            max_parallel_episodes=int(
                values.get("MOFANG_MAX_PARALLEL_EPISODES", "3")
            ),
        )
