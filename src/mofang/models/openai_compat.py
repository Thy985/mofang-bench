from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx

from .provider import ModelParams, ModelTurn, ProviderError, ToolCall, Usage

DEFAULT_TIMEOUT = 120.0


def decode_json(response: httpx.Response) -> dict[str, Any]:
    text = response.text.strip()
    # 部分本地网关在普通 JSON 末尾附带 SSE 结束标记
    if text.endswith("data: [DONE]"):
        text = text[: -len("data: [DONE]")].rstrip()
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise ProviderError(
            "bad_response", f"invalid JSON response: {text[:200]}"
        ) from exc


class OpenAICompatibleAdapter:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        *,
        client: httpx.AsyncClient | None = None,
        retry_delay: float = 1.0,
        timeout: float = DEFAULT_TIMEOUT,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.retry_delay = retry_delay
        self.timeout = timeout
        self._client = client or httpx.AsyncClient(
            timeout=httpx.Timeout(timeout, connect=10.0)
        )

    async def close(self) -> None:
        await self._client.aclose()

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    async def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        params: ModelParams,
    ) -> ModelTurn:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": params.temperature,
            "max_tokens": params.max_tokens,
            "stream": False,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        payload.update(params.extra)
        response = await self._post(payload)
        return self._parse(response)

    async def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        last_error: str | None = None
        for attempt in range(4):
            try:
                response = await self._client.post(
                    f"{self.base_url}/chat/completions",
                    json=payload,
                    headers=self._headers,
                )
            except httpx.TransportError as exc:
                last_error = str(exc) or f"request timed out after {self.timeout:g}s"
                if attempt < 3:
                    await asyncio.sleep(self.retry_delay * (2**attempt))
                    continue
                kind = (
                    "timeout"
                    if isinstance(exc, httpx.TimeoutException)
                    else "transport"
                )
                raise ProviderError(kind, last_error, retryable=True) from exc
            if response.status_code == 429 or response.status_code >= 500:
                last_error = response.text
                if attempt < 3:
                    await asyncio.sleep(self.retry_delay * (2**attempt))
                    continue
                kind = "rate_limit" if response.status_code == 429 else "server"
                raise ProviderError(kind, last_error, retryable=True)
            if response.status_code in (401, 403):
                raise ProviderError("auth", response.text)
            if response.status_code >= 400:
                raise ProviderError("bad_request", response.text)
            return decode_json(response)
        raise ProviderError("server", last_error or "request failed", retryable=True)

    def _parse(self, data: dict[str, Any]) -> ModelTurn:
        choices = data.get("choices") or []
        if not choices:
            raise ProviderError("bad_response", "response has no choices")
        choice = choices[0]
        message = choice.get("message") or {}
        calls: list[ToolCall] = []
        for index, raw in enumerate(message.get("tool_calls") or []):
            function = raw.get("function") or {}
            raw_arguments = function.get("arguments") or ""
            try:
                arguments = json.loads(raw_arguments) if raw_arguments else {}
            except json.JSONDecodeError:
                arguments = None
            calls.append(
                ToolCall(
                    id=raw.get("id") or f"call-{index}",
                    name=function.get("name") or "",
                    arguments=arguments,
                    raw_arguments=raw_arguments,
                )
            )
        usage = data.get("usage") or {}
        return ModelTurn(
            content=message.get("content"),
            tool_calls=calls,
            usage=Usage(
                prompt_tokens=int(usage.get("prompt_tokens") or 0),
                completion_tokens=int(usage.get("completion_tokens") or 0),
            ),
            raw=data,
            finish_reason=choice.get("finish_reason"),
        )

    async def probe_tools(self) -> bool:
        payload = {
            "model": self.model,
            "messages": [{"role": "user", "content": "Reply with ok."}],
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "ping",
                        "description": "ping",
                        "parameters": {"type": "object", "properties": {}},
                    },
                }
            ],
            "tool_choice": "auto",
            "max_tokens": 16,
            "stream": False,
        }
        try:
            await self._post(payload)
        except ProviderError as exc:
            if exc.kind == "bad_request" and "tool" in str(exc).lower():
                return False
            raise
        return True
