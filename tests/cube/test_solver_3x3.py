import asyncio
import sys
from pathlib import Path

import pytest

from mofang.cube.moves import apply_moves
from mofang.cube.solver import RubikTwoPhaseClient, SolverError, facelets_3x3
from mofang.cube.solver_worker import missing_tables
from mofang.cube.state import CubeState


def test_solved_facelets() -> None:
    assert facelets_3x3(CubeState.solved(3)) == (
        "UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB"
    )


def test_facelets_after_one_move() -> None:
    state = apply_moves(CubeState.solved(3), ["R"])
    value = facelets_3x3(state)
    assert len(value) == 54
    assert value.count("U") == 9
    assert value.count("R") == 9
    assert value != facelets_3x3(CubeState.solved(3))


@pytest.mark.slow
def test_rubik_two_phase_solves() -> None:
    missing = missing_tables(Path.cwd())
    if missing:
        pytest.skip("3x3 tables missing: " + ", ".join(missing))
    client = RubikTwoPhaseClient()
    try:
        state = apply_moves(CubeState.solved(3), ["R", "U", "F'"])
        solution = client.solve(state)
        assert apply_moves(state, solution).is_solved()
    finally:
        client.close()


def test_reset_discards_stale_response_and_rebuilds(tmp_path: Path) -> None:
    """超时后旧进程的迟到响应不能被下一次调用读到。"""
    marker = tmp_path / "spawned.txt"
    worker = tmp_path / "worker.py"
    worker.write_text(
        "import json, os, sys, time\n"
        "marker = sys.argv[1]\n"
        "first = not os.path.exists(marker)\n"
        "if first:\n"
        "    open(marker, 'w').close()\n"
        "for line in sys.stdin:\n"
        "    json.loads(line)\n"
        "    if first:\n"
        "        time.sleep(3)\n"
        "        print(json.dumps({'ok': True, 'moves': ['STALE'],\n"
        "                          'length': 1}), flush=True)\n"
        "    else:\n"
        "        print(json.dumps({'ok': True, 'moves': ['R'],\n"
        "                          'length': 1}), flush=True)\n",
        encoding="utf-8",
    )
    client = RubikTwoPhaseClient(
        worker=[sys.executable, str(worker), str(marker)]
    )
    try:

        async def scenario() -> list[str]:
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(
                    asyncio.to_thread(client.solve, CubeState.solved(3)),
                    timeout=0.2,
                )
            await asyncio.to_thread(client.reset)
            return await asyncio.wait_for(
                asyncio.to_thread(client.solve, CubeState.solved(3)),
                timeout=5,
            )

        moves = asyncio.run(scenario())
    finally:
        client.close()
    assert moves == ["R"]
    assert "STALE" not in moves


def test_rebuild_failure_raises_solver_error(tmp_path: Path) -> None:
    client = RubikTwoPhaseClient(worker=[str(tmp_path / "missing-worker.exe")])
    try:
        with pytest.raises(SolverError) as excinfo:
            client.solve(CubeState.solved(3))
    finally:
        client.close()
    assert "failed to start solver worker" in str(excinfo.value)

