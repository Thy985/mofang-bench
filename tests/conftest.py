import pytest


@pytest.fixture(autouse=True)
def _disable_spa_hosting(monkeypatch: pytest.MonkeyPatch) -> None:
    # create_app() 未显式传 settings 时会读 os.environ，frontend/dist 一旦构建就会让非 /api 的 404 变成 index.html
    monkeypatch.setenv("MOFANG_WEB_DIR", "")
