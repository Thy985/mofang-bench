from __future__ import annotations

import argparse
import json
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


def authorized(header: str | None, expected: str | None) -> bool:
    if expected is None:
        return True
    return header == f"Bearer {expected}"


def build_completion(
    payload: dict[str, Any], moves: list[str]
) -> dict[str, Any]:
    tools = payload.get("tools") or []
    has_apply = any(
        (tool.get("function") or {}).get("name") == "apply_moves"
        for tool in tools
    )
    messages = payload.get("messages") or []
    last = messages[-1] if messages else {}
    if has_apply and last.get("role") != "tool":
        message = {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call-1",
                    "type": "function",
                    "function": {
                        "name": "apply_moves",
                        "arguments": json.dumps({"moves": moves}),
                    },
                }
            ],
        }
        finish_reason = "tool_calls"
    elif has_apply:
        message = {"role": "assistant", "content": "solved"}
        finish_reason = "stop"
    else:
        message = {"role": "assistant", "content": "ok"}
        finish_reason = "stop"
    return {
        "id": "chatcmpl-fake",
        "object": "chat.completion",
        "model": payload.get("model", "fake"),
        "choices": [
            {
                "index": 0,
                "message": message,
                "finish_reason": finish_reason,
            }
        ],
        "usage": {
            "prompt_tokens": 10,
            "completion_tokens": 5,
            "total_tokens": 15,
        },
    }


def build_stream_frames(payload: dict[str, Any], moves: list[str]) -> bytes:
    completion = build_completion(payload, moves)
    message = completion["choices"][0]["message"]
    frames: list[str] = [
        "data: " + json.dumps({"choices": [{"delta": {"role": "assistant"}}]})
        + "\n\n"
    ]
    thinking = "先检查当前状态，再决定走法。"
    for piece in (thinking[:6], thinking[6:12], thinking[12:]):
        frames.append(
            "data: "
            + json.dumps({"choices": [{"delta": {"reasoning_content": piece}}]})
            + "\n\n"
        )
    if message.get("tool_calls"):
        arguments = message["tool_calls"][0]["function"]["arguments"]
        half = len(arguments) // 2
        for piece in (arguments[:half], arguments[half:]):
            frames.append(
                "data: "
                + json.dumps(
                    {
                        "choices": [
                            {
                                "delta": {
                                    "tool_calls": [
                                        {
                                            "index": 0,
                                            "id": "call-1",
                                            "type": "function",
                                            "function": {
                                                "name": "apply_moves",
                                                "arguments": piece,
                                            },
                                        }
                                    ]
                                }
                            }
                        ]
                    }
                )
                + "\n\n"
            )
        frames.append(
            "data: "
            + json.dumps(
                {
                    "choices": [
                        {"delta": {}, "finish_reason": "tool_calls"}
                    ]
                }
            )
            + "\n\n"
        )
    else:
        content = message.get("content") or ""
        frames.append(
            "data: "
            + json.dumps({"choices": [{"delta": {"content": content}}]})
            + "\n\n"
        )
        frames.append(
            "data: " + json.dumps({"choices": [{"delta": {}, "finish_reason": "stop"}]})
            + "\n\n"
        )
    frames.append(
        "data: " + json.dumps({"choices": [], "usage": completion["usage"]}) + "\n\n"
    )
    frames.append("data: [DONE]\n\n")
    return "".join(frames).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    moves: list[str] = ["R'"]
    api_key: str | None = None

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json({"ok": True})
            return
        self.send_error(404)

    def do_POST(self) -> None:
        if not self.path.endswith("/chat/completions"):
            self.send_error(404)
            return
        if not authorized(self.headers.get("Authorization"), self.api_key):
            self._json(
                {"error": {"message": "invalid api key"}}, status=401
            )
            return
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length) or b"{}")
        if payload.get("stream"):
            raw = build_stream_frames(payload, self.moves)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            # 逐帧写出并稍作间隔，模拟真实网关的到达节奏：
            # 让客户端的 thinking 节流（0.15s）能在流中实际触发，
            # 也让 E2E 页面加载（three.js chunk）完成后仍有实时 delta 可见。
            for frame in raw.split(b"\n\n"):
                if not frame:
                    continue
                self.wfile.write(frame + b"\n\n")
                self.wfile.flush()
                time.sleep(0.15)
            return
        self._json(build_completion(payload, self.moves))

    def _json(self, body: dict[str, Any], status: int = 200) -> None:
        raw = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, format: str, *args: Any) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=20129)
    parser.add_argument("--move", action="append", dest="moves")
    parser.add_argument("--api-key", default=None)
    args = parser.parse_args()
    if args.moves:
        Handler.moves = args.moves
    Handler.api_key = args.api_key
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"fake openai listening on {args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
