from mofang.runner.context import ContextBuilder, TurnRecord, task_message


def test_first_message_is_bounded() -> None:
    builder = ContextBuilder(system="SYS", task=task_message(100))
    messages = builder.build(
        state_json={"cube": "2x2", "faces": {}},
        move_history=[],
        records=[],
    )
    assert messages[0] == {"role": "system", "content": "SYS"}
    assert messages[1]["role"] == "user"
    assert messages[-1]["role"] == "user"
    assert "当前局面" in messages[-1]["content"]


def test_keeps_only_recent_turns() -> None:
    builder = ContextBuilder(system="SYS", task=task_message(100), keep_turns=2)
    records = [
        TurnRecord(
            assistant={"role": "assistant", "content": f"a{i}", "tool_calls": []},
            tool_results=[{"role": "tool", "tool_call_id": f"t{i}", "content": "{}"}],
        )
        for i in range(5)
    ]
    messages = builder.build(
        state_json={"cube": "2x2", "faces": {}},
        move_history=["R", "U"],
        records=records,
    )
    contents = [message.get("content") for message in messages]
    assert "a3" in contents
    assert "a4" in contents
    assert "a0" not in contents


def test_move_history_in_state_message() -> None:
    builder = ContextBuilder(system="SYS", task=task_message(100))
    messages = builder.build(
        state_json={"cube": "2x2", "faces": {}},
        move_history=["R", "U'"],
        records=[],
    )
    assert "R U'" in messages[-1]["content"]
