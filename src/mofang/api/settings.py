from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping


@dataclass(frozen=True)
class Settings:
    db_path: Path = Path("data/mofang.db")
    table_path: Path = Path("data/cache/2x2_distances.pkl")
    host: str = "127.0.0.1"
    port: int = 8000
    cors_origins: tuple[str, ...] = (
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    )

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        values = os.environ if env is None else env
        return cls(
            db_path=Path(values.get("MOFANG_DB", "data/mofang.db")),
            table_path=Path(
                values.get("MOFANG_TABLE", "data/cache/2x2_distances.pkl")
            ),
            host=values.get("MOFANG_HOST", "127.0.0.1"),
            port=int(values.get("MOFANG_PORT", "8000")),
        )
