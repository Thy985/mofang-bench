import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.fake_openai_server import build_completion  # noqa: E402


def test_build_completion_returns_tool_call_then_content() -> None:
    tools = [
        {
            "type": "function",
            "function": {"name": "apply_moves"},
        }
    ]
    first = build_completion(
        {"messages": [{"role": "user", "content": "go"}], "tools": tools},
        ["R'"],
    )
    call = first["choices"][0]["message"]["tool_calls"][0]
    assert call["function"]["name"] == "apply_moves"
    assert call["function"]["arguments"] == '{"moves": ["R\'"]}'

    second = build_completion(
        {
            "messages": [
                {"role": "user", "content": "go"},
                {"role": "tool", "content": "ok"},
            ],
            "tools": tools,
        },
        ["R'"],
    )
    assert second["choices"][0]["message"]["content"] == "solved"


def test_build_completion_handles_probe() -> None:
    response = build_completion(
        {
            "messages": [{"role": "user", "content": "Reply with ok."}],
            "tools": [
                {
                    "type": "function",
                    "function": {"name": "ping"},
                }
            ],
        },
        ["R'"],
    )
    assert response["choices"][0]["message"]["content"] == "ok"
