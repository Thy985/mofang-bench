from pathlib import Path

from fastapi.testclient import TestClient

from mofang.api.app import create_app
from mofang.api.settings import Settings


def test_serves_spa_and_keeps_api_404(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>app</html>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text(
        "console.log(1)", encoding="utf-8"
    )
    app = create_app(
        Settings(db_path=tmp_path / "t.db", web_dir=dist),
        env={},
    )
    with TestClient(app) as client:
        assert client.get("/runs/abc").text == "<html>app</html>"
        assert client.get("/assets/app.js").text == "console.log(1)"
        assert client.get("/api/nope").status_code == 404
        assert client.get("/api/nope").headers["content-type"].startswith(
            "application/json"
        )
        assert client.get("/openapi.json").status_code == 200


def test_web_dir_from_env_can_be_disabled() -> None:
    assert Settings.from_env({"MOFANG_WEB_DIR": ""}).web_dir is None
    assert (
        Settings.from_env({"MOFANG_WEB_DIR": "dist"}).web_dir
        == Path("dist")
    )


def test_serve_parser_web_dir_override() -> None:
    from mofang.cli import build_parser

    args = build_parser().parse_args(["serve", "--web-dir", ""])
    assert args.web_dir == ""


def test_spa_stays_inside_web_dir(tmp_path: Path) -> None:
    secret = tmp_path / "secret.txt"
    secret.write_text("outside", encoding="utf-8")
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>app</html>", encoding="utf-8")
    app = create_app(
        Settings(db_path=tmp_path / "t.db", web_dir=dist),
        env={},
    )
    with TestClient(app) as client:
        for path in (
            "/../secret.txt",
            "/%2e%2e/secret.txt",
            "/..%2fsecret.txt",
            "/%2e%2e%2f%2e%2e%2fsecret.txt",
            "/%2fsecret.txt",
            "/assets/%2e%2e/secret.txt",
        ):
            assert client.get(path).text != "outside"
        assert client.get("/%2e%2e/secret.txt").text == "<html>app</html>"


def test_serves_files_directly_under_web_dir(tmp_path: Path) -> None:
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<html>app</html>", encoding="utf-8")
    (dist / "favicon.ico").write_text("icon", encoding="utf-8")
    app = create_app(
        Settings(db_path=tmp_path / "t.db", web_dir=dist),
        env={},
    )
    with TestClient(app) as client:
        assert client.get("/favicon.ico").text == "icon"
        assert client.get("/").text == "<html>app</html>"


def test_no_mount_without_index(tmp_path: Path) -> None:
    app = create_app(
        Settings(db_path=tmp_path / "t.db", web_dir=tmp_path / "missing"),
        env={},
    )
    with TestClient(app) as client:
        assert client.get("/runs/abc").status_code == 404
