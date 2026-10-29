from __future__ import annotations

import argparse
import os
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

import uvicorn

from .api.app import create_app
from .api.settings import Settings


def node_bin() -> str:
    node = shutil.which("node")
    if node is None:
        raise SystemExit(
            "缺少 Node.js：请先安装 Node.js 24 并确保 node 在 PATH 中"
        )
    return node


def vite_bin(frontend: Path) -> Path:
    path = frontend / "node_modules" / "vite" / "bin" / "vite.js"
    if not path.is_file():
        raise SystemExit(
            "前端依赖未安装：请先执行 cd frontend && npm install"
        )
    return path


def port_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind((host, port))
        except OSError:
            return False
    return True


def wait_http(url: str, timeout: float) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status < 500:
                    return True
        except (urllib.error.URLError, OSError):
            pass
        time.sleep(0.2)
    return False


def vite_command(
    node: str, vite: Path, host: str, port: int
) -> list[str]:
    return [
        node,
        str(vite),
        "--host",
        host,
        "--port",
        str(port),
        "--strictPort",
    ]


def stop_process(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
            capture_output=True,
            check=False,
        )
    else:
        proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()


def _interrupt(signum: int, frame: object) -> None:
    raise KeyboardInterrupt


def run_dev(args: argparse.Namespace) -> int:
    if hasattr(signal, "SIGBREAK"):
        # Windows 默认对 Ctrl+Break 直接终止进程，收不到 KeyboardInterrupt；
        # 显式转成同一异常，保证 finally 里的子进程/端口清扫一定执行。
        signal.signal(signal.SIGBREAK, _interrupt)
    frontend = Path("frontend").resolve()
    node = node_bin()
    vite = vite_bin(frontend)
    for label, port in (("API", args.port), ("前端", args.ui_port)):
        if not port_free(args.host, port):
            raise SystemExit(
                f"{label}端口 {args.host}:{port} 已被占用，请先停止占用进程"
            )

    settings = Settings(
        db_path=Path(args.db),
        table_path=Path(args.table),
        web_dir=None,
        host=args.host,
        port=args.port,
    )
    server = uvicorn.Server(
        uvicorn.Config(
            create_app(settings),
            host=args.host,
            port=args.port,
            log_level="info",
        )
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    proc: subprocess.Popen | None = None
    try:
        if not wait_http(
            f"http://{args.host}:{args.port}/api/providers", 20
        ):
            raise SystemExit("API 启动失败：请检查端口与数据库配置")
        env = dict(os.environ)
        env["MOFANG_API_PORT"] = str(args.port)
        proc = subprocess.Popen(
            vite_command(node, vite, args.host, args.ui_port),
            cwd=str(frontend),
            env=env,
        )
        ui_url = f"http://{args.host}:{args.ui_port}/"
        if not wait_http(ui_url, 30):
            raise SystemExit("前端启动失败：请检查 Vite 日志")
        print(f"Web: {ui_url}")
        print(f"API: http://{args.host}:{args.port}/api")
        print("按 Ctrl+C 停止")
        if args.open:
            webbrowser.open(ui_url)
        while proc.poll() is None and thread.is_alive():
            time.sleep(0.2)
        if proc.poll() not in (None, 0):
            print(f"前端进程退出，code={proc.returncode}", file=sys.stderr)
            return 1
        if not thread.is_alive():
            print("API 进程退出", file=sys.stderr)
            return 1
        return 0
    except KeyboardInterrupt:
        return 0
    finally:
        if proc is not None:
            stop_process(proc)
        server.should_exit = True
        thread.join(timeout=10)
