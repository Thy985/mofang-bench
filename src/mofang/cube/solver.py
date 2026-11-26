from __future__ import annotations

import json
import subprocess
import sys
import threading
from typing import Protocol

from .colors import FACE_COLOR, FACE_ORDER
from .state import CubeState


class SolverError(RuntimeError):
    pass


class ReferenceSolver(Protocol):
    reference_kind: str

    def solve(self, state: CubeState) -> list[str]: ...

    def distance(self, state: CubeState) -> int | None: ...


class FakeSolver:
    reference_kind = "fake"

    def __init__(
        self,
        distances: dict[str, int] | None = None,
        solutions: dict[str, list[str]] | None = None,
    ) -> None:
        self.distances = distances or {}
        self.solutions = solutions or {}

    def distance(self, state: CubeState) -> int | None:
        return self.distances.get(state.key())

    def solve(self, state: CubeState) -> list[str]:
        try:
            return list(self.solutions[state.key()])
        except KeyError as exc:
            raise SolverError("no fake solution for state") from exc


def facelets_3x3(state: CubeState) -> str:
    if state.size != 3:
        raise ValueError("3x3 state required")
    letter = {FACE_COLOR[face]: face for face in FACE_ORDER}
    return "".join(
        letter[color] for grid in state.faces for row in grid for color in row
    )


class RubikTwoPhaseClient:
    reference_kind = "near_optimal"

    def __init__(
        self,
        python: str | None = None,
        *,
        worker: list[str] | None = None,
    ) -> None:
        self._python = python
        self._worker = list(worker) if worker else None
        self._lock = threading.Lock()
        self._process: subprocess.Popen[str] | None = None

    def _command(self) -> list[str]:
        if self._worker is not None:
            return list(self._worker)
        return [self._python or sys.executable, "-m", "mofang.cube.solver_worker"]

    def _ensure_process(self) -> subprocess.Popen[str]:
        process = self._process
        if process is not None and process.poll() is None:
            return process
        self._process = None
        if process is not None:
            self._terminate(process)
        try:
            process = subprocess.Popen(
                self._command(),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                bufsize=1,
            )
        except OSError as exc:
            raise SolverError(f"failed to start solver worker: {exc}") from exc
        self._process = process
        return process

    @staticmethod
    def _terminate(process: subprocess.Popen[str]) -> None:
        """终止进程并回收；不要先 close 管道，避免和阻塞中的 readline 抢锁。"""
        if process.poll() is None:
            try:
                process.kill()
            except OSError:
                pass
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream is not None:
                try:
                    stream.close()
                except Exception:
                    pass

    def _discard(self, process: subprocess.Popen[str]) -> None:
        """只丢弃自己捕获的这个进程，避免误杀重建后的新 worker。"""
        if self._process is process:
            self._process = None
        self._terminate(process)

    def reset(self) -> None:
        """丢弃当前 worker。

        solve 超时后，线程可能仍阻塞在旧进程的 readline 上；旧响应也可能
        迟到。把进程标记为不可信并终止，下一次调用走新进程，绝不复用旧管道。
        """
        process = self._process
        self._process = None
        if process is not None:
            self._terminate(process)

    def _request(self, payload: dict) -> dict:
        with self._lock:
            process = self._ensure_process()
            if process.stdin is None or process.stdout is None:
                self._discard(process)
                raise SolverError("solver worker is not running")
            try:
                process.stdin.write(json.dumps(payload) + "\n")
                process.stdin.flush()
                line = process.stdout.readline()
            except (OSError, ValueError) as exc:
                self._discard(process)
                raise SolverError(f"solver worker request failed: {exc}") from exc
            if not line:
                stderr = ""
                if process.stderr is not None:
                    try:
                        stderr = process.stderr.read()
                    except (OSError, ValueError):
                        pass
                self._discard(process)
                raise SolverError(f"solver worker exited: {stderr}")
            try:
                return json.loads(line)
            except json.JSONDecodeError as exc:
                self._discard(process)
                raise SolverError(
                    f"solver worker sent invalid JSON: {exc}"
                ) from exc

    def solve(self, state: CubeState) -> list[str]:
        response = self._request({"facelets": facelets_3x3(state)})
        if not response.get("ok"):
            raise SolverError(str(response.get("error", "solver error")))
        return list(response["moves"])

    def distance(self, state: CubeState) -> int | None:
        try:
            return len(self.solve(state))
        except SolverError:
            return None

    def close(self) -> None:
        process = self._process
        self._process = None
        if process is not None:
            self._terminate(process)

    def __enter__(self) -> "RubikTwoPhaseClient":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()
