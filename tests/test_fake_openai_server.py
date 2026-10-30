import sys
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.fake_openai_server import (  # noqa: E402
    Handler,
    authorized,
    build_completion,
)


def _start_fake_server() -> tuple[str, ThreadingHTTPServer]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    host, port = server.server_address
    return f"http://{host}:{port}", server


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


def test_authorized_checks_bearer_token_when_configured() -> None:
    assert authorized(None, None) is True
    assert authorized("Bearer test", "test") is True
    assert authorized(None, "test") is False
    assert authorized("Bearer wrong", "test") is False


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


def test_stream_payload_returns_sse() -> None:
    import json
    import urllib.request

    base_url, server = _start_fake_server()
    try:
        payload = {
            "model": "fake",
            "stream": True,
            "messages": [{"role": "user", "content": "go"}],
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "apply_moves",
                        "parameters": {"type": "object", "properties": {}},
                    },
                }
            ],
        }
        req = urllib.request.Request(
            f"{base_url}/v1/chat/completions",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        body = urllib.request.urlopen(req).read().decode()
        assert body.startswith("data: ")
        assert "reasoning_content" in body
        assert "apply_moves" in body
        assert body.rstrip().endswith("data: [DONE]")
    finally:
        server.shutdown()
        server.server_close()
