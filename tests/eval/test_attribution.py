from mofang.cube.moves import apply_moves
from mofang.cube.state import CubeState
from mofang.eval.attribution import attribution_summary, classify_failure
from mofang.runner.episode import EpisodeResult, EpisodeStatus
from mofang.tasks.models import Task


def make_result(**overrides) -> EpisodeResult:
    defaults = dict(
        status=EpisodeStatus.STOPPED_UNSOLVED,
        solved=False,
        moves_used=0,
        reference_length=2,
        efficiency=None,
        progress_ratio=0.0,
        invalid_calls=0,
        protocol_errors=0,
        tokens_in=0,
        tokens_out=0,
        latency_ms=0,
        final_state={},
        failure_code="stopped_unsolved",
        error=None,
    )
    defaults.update(overrides)
    return EpisodeResult(**defaults)


def make_task(task_id: str = "t1") -> Task:
    return Task(
        id=task_id,
        cube="2x2",
        scramble=["R"],
        scramble_depth=1,
        state=apply_moves(CubeState.solved(2), ["R"]).to_json(),
        reference_length=1,
        reference_kind="exact",
        bin="1",
    )


def test_provider_error_is_env_side() -> None:
    verdict = classify_failure(
        make_result(
            status=EpisodeStatus.PROVIDER_ERROR,
            failure_code="provider_error",
            error="connection refused",
            provider_errors=2,
        )
    )
    assert verdict["side"] == "env"
    assert any("网络/服务端" in signal for signal in verdict["signals"])


def test_timeout_is_env_side_with_signal() -> None:
    verdict = classify_failure(
        make_result(
            status=EpisodeStatus.TIMEOUT,
            failure_code="timeout",
            progress_ratio=0.5,
        )
    )
    assert verdict["side"] == "env"
    assert any("超时" in signal for signal in verdict["signals"])
    assert any("预算可能偏紧" in signal for signal in verdict["signals"])


def test_stopped_unsolved_is_model_side() -> None:
    verdict = classify_failure(make_result())
    assert verdict["side"] == "model"
    assert any("未取得任何进展" in signal for signal in verdict["signals"])


def test_protocol_error_hint_and_progress_signal() -> None:
    verdict = classify_failure(
        make_result(
            status=EpisodeStatus.PROTOCOL_ERROR,
            failure_code="protocol_error",
            protocol_errors=4,
            moves_used=3,
            progress_ratio=0.0,
        )
    )
    assert verdict["side"] == "model"
    assert any("提示词/工具描述" in signal for signal in verdict["signals"])
    # 零进展与协议错误两个信号可以并存
    assert any("未取得任何进展" in signal for signal in verdict["signals"])


def test_cancelled_is_user_side_and_not_counted() -> None:
    cancelled = make_result(
        status=EpisodeStatus.CANCELLED,
        failure_code="cancelled",
    )
    verdict = classify_failure(cancelled)
    assert verdict["side"] == "user"
    summary = attribution_summary([make_task()], [cancelled])
    assert summary["failed"] == 1
    assert summary["env"] == 0
    assert summary["model"] == 0


def test_summary_solved_episodes_excluded() -> None:
    summary = attribution_summary(
        [make_task()],
        [
            make_result(
                status=EpisodeStatus.SOLVED,
                solved=True,
                failure_code=None,
                progress_ratio=1.0,
            )
        ],
    )
    assert summary["failed"] == 0
    assert summary["items"] == []


def test_summary_counts_sides_and_signals() -> None:
    results = [
        make_result(),  # model / progress 0
        make_result(
            status=EpisodeStatus.PROVIDER_ERROR,
            failure_code="provider_error",
            provider_errors=1,
        ),
    ]
    summary = attribution_summary([make_task("a"), make_task("b")], results)
    assert summary["env"] == 1
    assert summary["model"] == 1
    assert summary["codes"] == {
        "stopped_unsolved": 1,
        "provider_error": 1,
    }
    assert summary["signals"].get("本局发生网络/服务端错误或重试") == 1
    assert summary["items"][0]["task_id"] == "a"
