import socket
from pathlib import Path

import pytest

from mofang.cli import build_parser
from mofang.dev import node_bin, port_free, vite_bin, vite_command


def test_dev_parser_defaults() -> None:
    args = build_parser().parse_args(["dev"])
    assert args.command == "dev"
    assert args.host == "127.0.0.1"
    assert args.port == 8000
    assert args.ui_port == 5173
    assert args.db == "data/mofang.db"
    assert args.table == "data/cache/2x2_distances.pkl"
    assert args.open is False


def test_vite_command_pins_host_and_port() -> None:
    command = vite_command(
        "node", Path("frontend/node_modules/vite/bin/vite.js"), "127.0.0.1", 5181
    )
    assert command == [
        "node",
        str(Path("frontend/node_modules/vite/bin/vite.js")),
        "--host",
        "127.0.0.1",
        "--port",
        "5181",
        "--strictPort",
    ]


def test_vite_bin_requires_npm_install(tmp_path: Path) -> None:
    with pytest.raises(SystemExit) as exc:
        vite_bin(tmp_path)
    assert "npm install" in str(exc.value)


def test_node_bin_reports_missing_node(monkeypatch) -> None:
    monkeypatch.setattr("mofang.dev.shutil.which", lambda name: None)
    with pytest.raises(SystemExit) as exc:
        node_bin()
    assert "Node.js" in str(exc.value)


def test_port_free_detects_listener() -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        sock.listen()
        port = sock.getsockname()[1]
        assert port_free("127.0.0.1", port) is False
    assert port_free("127.0.0.1", port) is True
