"""阶段守卫 + OLL 只读计数 + skill=none 零影响的测试。"""

import pytest

from mofang.cube.moves import apply_moves
from mofang.cube.state import CubeState
from mofang.cube.table2x2 import Table2x2Solver, build_table
from mofang.models.provider import FakeProvider, ModelTurn, ToolCall
from mofang.runner.budget import Budget
from mofang.runner.context import system_prompt
from mofang.runner.episode import EpisodeRunner
from mofang.runner.skills import pack_for
from mofang.runner.tools import ToolExecutor
from mofang.tasks.models import Task

# 该打乱让 D 面先变单色（yellow），U 面仍是 blue/green 各 2 格。
SCRAMBLE = ["R2", "U2", "R", "U2", "R2"]


def stage_state() -> CubeState:
    return apply_moves(CubeState.solved(2), SCRAMBLE)


def make_task() -> Task:
    solver = Table2x2Solver(build_table(max_depth=3))
    state = stage_state()
    return Task(
        id="t1",
        cube="2x2",
        scramble=SCRAMBLE,
        scramble_depth=len(SCRAMBLE),
        state=state.to_json(),
        reference_length=solver.distance(state) or 999,
        reference_kind="exact",
        bin="test",
    )


def test_guard_flags_broken_first_face_after_apply_moves() -> None:
    executor = ToolExecutor(stage_state(), 20, 20, skill="ortega")
    executor.turn_index = 1
    assert executor.execute("probe_oll", {}).ok
    first = executor.execute("apply_moves", {"moves": []})
    assert first.payload["stage_completed"] == ["D_face"]
    assert "stage_broken" not in first.payload

    executor.turn_index = 8
    assert executor.execute("probe_oll", {}).ok
    out = executor.execute("apply_moves", {"moves": ["R"]})
    assert out.ok is True
    assert out.payload["phase"] == "D-face"
    assert out.payload["applied"] == ["R"]
    broken = out.payload["stage_broken"]
    assert broken["stage"] == "D_face"
    assert broken["established_turn"] == 0
    assert broken["current_phase"] == "D-face"
    assert "起始局面" in broken["detail"]
    assert "D 面" in broken["detail"]


def test_guard_flags_broken_first_face_after_turn_tool() -> None:
    executor = ToolExecutor(stage_state(), 20, 20, skill="ortega")
    executor.turn_index = 3
    assert executor.execute("probe_oll", {}).ok
    out = executor.execute("turn", {"face": "R", "amount": 1})
    assert out.payload["stage_broken"]["established_turn"] == 0


def test_guard_reestablishes_after_restore() -> None:
    executor = ToolExecutor(stage_state(), 20, 20, skill="ortega")
    executor.turn_index = 8
    assert executor.execute("probe_oll", {}).ok
    executor.execute("apply_moves", {"moves": ["R"]})
    assert "D_face" not in executor.stage_established

    executor.turn_index = 9
    back = executor.execute("apply_moves", {"moves": ["R'"]})
    assert back.payload["stage_completed"] == ["D_face"]
    assert "stage_broken" not in back.payload
    assert executor.stage_established["D_face"]["turn"] == 9


def test_skill_none_payload_and_state_untouched() -> None:
    executor = ToolExecutor(stage_state(), 20, 20)
    for tool, args in (
        ("apply_moves", {"moves": ["R"]}),
        ("turn", {"face": "R", "amount": 2}),
    ):
        out = executor.execute(tool, args)
        assert set(out.payload) == {
            "ok",
            "state",
            "solved",
            "moves_used",
            "moves_remaining",
            "applied",
        }
    assert executor.stage_established == {}


def test_oll_gate_blocks_landing_before_probe_in_oll_phase() -> None:
    for tool, args in (
        ("apply_moves", {"moves": ["R"]}),
        ("turn", {"face": "R", "amount": 1}),
    ):
        executor = ToolExecutor(stage_state(), 20, 20, skill="ortega")
        executor.turn_index = 1
        before = executor.state.to_json()
        out = executor.execute(tool, args)
        assert out.ok is False
        assert out.payload["error"] == "probe_oll_required"
        assert "probe_oll" in out.payload["detail"]
        assert executor.state.to_json() == before
        assert executor.moves_used == 0
        assert executor.protocol_errors == 0


def test_oll_gate_allows_landing_after_probe_in_same_turn() -> None:
    executor = ToolExecutor(stage_state(), 20, 20, skill="ortega")
    executor.turn_index = 1
    assert executor.execute("probe_oll", {}).ok is True
    # U 调整不破坏 D 面，落地后仍在 OLL 阶段。
    out = executor.execute("apply_moves", {"moves": ["U"]})
    assert out.ok is True
    assert out.payload["applied"] == ["U"]
    assert out.payload["phase"] == "OLL"

    # 下一轮需要重新 probe，否则再次被拦截。
    executor.turn_index = 2
    out = executor.execute("apply_moves", {"moves": ["U"]})
    assert out.ok is False
    assert out.payload["error"] == "probe_oll_required"
    assert executor.execute("probe_oll", {}).ok is True
    out = executor.execute("apply_moves", {"moves": ["U"]})
    assert out.ok is True


def test_oll_gate_does_not_apply_outside_oll_phase() -> None:
    executor = ToolExecutor(stage_state(), 20, 20, skill="ortega")
    executor.turn_index = 1
    assert executor.execute("probe_oll", {}).ok is True
    broken = executor.execute("apply_moves", {"moves": ["R"]})
    assert broken.payload["phase"] == "D-face"

    # D 面阶段（非 OLL）不需要先 probe。
    executor.turn_index = 2
    back = executor.execute("apply_moves", {"moves": ["R'"]})
    assert back.ok is True
    assert back.payload["applied"] == ["R'"]


def test_landing_receipt_carries_oll_delta() -> None:
    executor = ToolExecutor(stage_state(), 20, 20, skill="ortega")
    executor.turn_index = 1
    assert executor.execute("probe_oll", {}).ok is True
    out = executor.execute(
        "apply_moves", {"moves": ["R2", "U2", "R'", "U2", "R2"]}
    )
    assert out.ok is True
    assert out.payload["solved"] is True
    assert out.payload["oll_delta"] == {
        "target_color": "white",
        "before": 0,
        "after": 4,
        "delta": 4,
        "phase_after": "done",
    }


def test_probe_oll_counts_are_machine_readable_not_move_advice() -> None:
    executor = ToolExecutor(stage_state(), 20, 20, skill="ortega")
    executor.turn_index = 1
    out = executor.execute("probe_oll", {})
    payload = out.payload
    assert payload["ok"] is True
    assert payload["phase"] == "OLL"
    assert payload["target_color"] == "white"
    assert payload["same_color_corners"] == 0
    assert payload["bar_faces"] == ["F", "B"]
    assert payload["d_intact"] is True
    assert not any(
        key in payload for key in ("moves", "branch", "formula", "recommendation")
    )


@pytest.mark.parametrize("skill", ["none", "lbl"])
def test_probe_oll_rejected_outside_ortega(skill: str) -> None:
    executor = ToolExecutor(stage_state(), 20, 20, skill=skill)
    out = executor.execute("probe_oll", {})
    assert out.ok is False
    assert out.payload["error"] == "tool_not_enabled"


def test_skill_none_prompt_is_byte_identical() -> None:
    assert pack_for("none") is None
    assert system_prompt(False, solver_assist=False, skill_pack=None) == (
        system_prompt(False, solver_assist=False)
    )


async def _run_episode(skill: str) -> tuple[list[tuple[str, dict]], list[str]]:
    seen: list[tuple[str, dict]] = []
    events: list[str] = []

    def emit(kind: str, payload: dict) -> None:
        events.append(kind)
        if kind in ("tool.result", "model.turn.started", "move.applied"):
            seen.append((kind, payload))

    calls = [
        ToolCall(id="c1", name="apply_moves", arguments={"moves": ["R"]})
    ]
    if skill == "ortega":
        # OLL 阶段必须先 probe 才能落地，否则被工具层拦截。
        calls.insert(0, ToolCall(id="p1", name="probe_oll", arguments={}))
    provider = FakeProvider([ModelTurn(tool_calls=calls)])
    runner = EpisodeRunner(
        provider=provider,
        solver=Table2x2Solver(build_table(max_depth=3)),
        budget=Budget(max_moves=20),
        params={},
        tool_mode="both",
        require_plan=False,
        solver_mode="off",
        skill=skill,
    )
    await runner.run(make_task(), emit=emit)
    return seen, events


async def test_skill_ortega_episode_emits_stage_broken_event() -> None:
    seen, events = await _run_episode("ortega")
    assert "stage.broken" in events
    results = [payload for kind, payload in seen if kind == "tool.result"]
    landed = [item for item in results if item["tool"] == "apply_moves"]
    assert landed[0]["payload"]["stage_broken"]["established_turn"] == 0


async def test_skill_none_episode_has_no_stage_events_or_fields() -> None:
    seen, events = await _run_episode("none")
    assert "stage.broken" not in events
    results = [payload for kind, payload in seen if kind == "tool.result"]
    assert set(results[0]["payload"]) == {
        "ok",
        "state",
        "solved",
        "moves_used",
        "moves_remaining",
        "applied",
    }
