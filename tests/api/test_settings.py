from pathlib import Path

from mofang.api.settings import Settings


def test_settings_defaults() -> None:
    settings = Settings.from_env({})
    assert settings.db_path == Path("data/mofang.db")
    assert settings.table_path == Path("data/cache/2x2_distances.pkl")
    assert settings.host == "127.0.0.1"
    assert settings.port == 8000
    assert settings.cors_origins == (
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    )


def test_settings_env_override() -> None:
    settings = Settings.from_env(
        {
            "MOFANG_DB": "tmp/test.db",
            "MOFANG_TABLE": "tmp/table.pkl",
            "MOFANG_HOST": "localhost",
            "MOFANG_PORT": "9001",
        }
    )
    assert settings.db_path == Path("tmp/test.db")
    assert settings.table_path == Path("tmp/table.pkl")
    assert settings.host == "localhost"
    assert settings.port == 9001
