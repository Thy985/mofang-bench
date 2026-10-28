from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


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


class Handler(BaseHTTPRequestHandler):
    moves: list[str] = ["R'"]

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json({"ok": True})
            return
        self.send_error(404)

    def do_POST(self) -> None:
        if not self.path.endswith("/chat/completions"):
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length) or b"{}")
        self._json(build_completion(payload, self.moves))

    def _json(self, body: dict[str, Any]) -> None:
        raw = json.dumps(body).encode("utf-8")
        self.send_response(200)
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
    args = parser.parse_args()
    if args.moves:
        Handler.moves = args.moves
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"fake openai listening on {args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
