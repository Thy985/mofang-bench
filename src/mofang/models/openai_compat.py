from __future__ import annotations

import asyncio
import json
import re
from dataclasses import replace
from typing import Any, Callable

import httpx

from .provider import ModelParams, ModelTurn, ProviderError, ToolCall, Usage

DEFAULT_TIMEOUT = 120.0
MAX_TOKENS_FALLBACK = 8192
# 400 且报错指向上限（max_tokens / context length）时，单回合输出预算
# 超出该模型的输出上限；降级到 MAX_TOKENS_FALLBACK 重试一次。
_MAX_TOKENS_ERROR_RE = re.compile(
    r"max_tokens|maximum context|context length", re.IGNORECASE
)


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


_THINK_RE = re.compile(r"<think>(.*?)</think>", re.DOTALL)


def split_think(content: str | None) -> tuple[str | None, str | None]:
    """把 content 里 <think>...</think> 段剥离为 (正文, 思考文本)。"""
    if not content:
        return content, None
    parts = _THINK_RE.findall(content)
    if not parts:
        return content, None
    remaining = _THINK_RE.sub("", content).strip()
    think = "\n\n".join(part.strip() for part in parts if part.strip())
    return (remaining or None), (think or None)


class OpenAICompatibleAdapter:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        model: str,
        *,
        client: httpx.AsyncClient | None = None,
        retry_delay: float = 2.0,
        timeout: float = DEFAULT_TIMEOUT,
        stream: bool = True,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.retry_delay = retry_delay
        self.timeout = timeout
        self.stream = stream
        self.downgraded = False
        self.max_tokens_downgraded = False
        # 失败归因用的计数器：requests=HTTP 尝试次数（含重试）、
        # retries=退避重试次数、errors=最终抛出的 ProviderError 次数。
        # EpisodeRunner 用进出场差值把环境侧异常摊到具体 episode。
        self.stats = {
            "requests": 0,
            "retries": 0,
            "errors": 0,
            "truncations": 0,
        }
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
        try:
            payload = self._build_payload(messages, tools, params, stream=False)
            response = await self._post(payload)
        except ProviderError as exc:
            self.stats["errors"] += 1
            params = self._downgraded_max_tokens(exc, params)
            if params is None:
                raise
            payload = self._build_payload(messages, tools, params, stream=False)
            try:
                response = await self._post(payload)
            except ProviderError as retry_exc:
                self.stats["errors"] += 1
                raise retry_exc
        return self._parse(response)

    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        params: ModelParams,
        on_delta: Callable[[str, str], None] | None = None,
    ) -> ModelTurn:
        if not self.stream:
            return await self.chat(messages, tools, params)
        try:
            payload = self._build_payload(messages, tools, params, stream=True)
            response = await self._open_stream(payload)
        except ProviderError as exc:
            self.stats["errors"] += 1
            params = self._downgraded_max_tokens(exc, params)
            if params is None:
                raise
            payload = self._build_payload(messages, tools, params, stream=True)
            try:
                response = await self._open_stream(payload)
            except ProviderError as retry_exc:
                self.stats["errors"] += 1
                raise retry_exc
        if response is None:
            self.downgraded = True
            return await self.chat(messages, tools, params)
        try:
            return await self._consume_stream(response, on_delta)
        except httpx.TransportError as exc:
            # 流中断不重试：重试会整 turn 重放并双计 usage。
            raise ProviderError("transport", str(exc)) from exc
        finally:
            await response.aclose()

    def _downgraded_max_tokens(
        self, exc: ProviderError, params: ModelParams
    ) -> ModelParams | None:
        if exc.kind != "bad_request" or not _MAX_TOKENS_ERROR_RE.search(
            str(exc)
        ):
            return None
        if params.max_tokens <= MAX_TOKENS_FALLBACK:
            return None
        self.max_tokens_downgraded = True
        # 降级只保证请求能发出去，不保证 reasoning 能写完；截断由
        # EpisodeRunner 用 finish_reason=length 显式处理。
        return replace(params, max_tokens=MAX_TOKENS_FALLBACK)

    def _build_payload(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        params: ModelParams,
        *,
        stream: bool,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": params.temperature,
            "max_tokens": params.max_tokens,
            "stream": stream,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        if stream:
            # 先写默认值再让 extra 覆盖，保证 params.extra 优先。
            payload["stream_options"] = {"include_usage": True}
        payload.update(params.extra)
        return payload

    async def _open_stream(
        self, payload: dict[str, Any]
    ) -> httpx.Response | None:
        """打开流式响应；返回 None 表示网关不支持流式（应降级）。"""
        last_error: str | None = None
        # 退避序列 retry_delay*(1,2,4)；默认 2s 时合计 14s，覆盖网关 8-10s
        # 的 429 reset 窗口。这些 sleep 计入 EpisodeRunner 的 turn_timeout。
        for attempt in range(4):
            self.stats["requests"] += 1
            try:
                response = await self._client.send(
                    self._client.build_request(
                        "POST",
                        f"{self.base_url}/chat/completions",
                        json=payload,
                        headers=self._headers,
                    ),
                    stream=True,
                )
            except httpx.TransportError as exc:
                last_error = str(exc) or f"request timed out after {self.timeout:g}s"
                if attempt < 3:
                    self.stats["retries"] += 1
                    await asyncio.sleep(self.retry_delay * (2**attempt))
                    continue
                kind = (
                    "timeout"
                    if isinstance(exc, httpx.TimeoutException)
                    else "transport"
                )
                raise ProviderError(kind, last_error, retryable=True) from exc
            if response.status_code == 429 or response.status_code >= 500:
                last_error = (await response.aread()).decode(errors="replace")
                await response.aclose()
                if attempt < 3:
                    self.stats["retries"] += 1
                    await asyncio.sleep(self.retry_delay * (2**attempt))
                    continue
                kind = "rate_limit" if response.status_code == 429 else "server"
                raise ProviderError(kind, last_error, retryable=True)
            if response.status_code in (401, 403):
                body = (await response.aread()).decode(errors="replace")
                await response.aclose()
                raise ProviderError("auth", body)
            if response.status_code >= 400:
                body = (await response.aread()).decode(errors="replace")
                await response.aclose()
                if "stream" in body.lower():
                    return None
                raise ProviderError("bad_request", body)
            return response
        raise ProviderError("server", last_error or "request failed", retryable=True)

    async def _consume_stream(
        self,
        response: httpx.Response,
        on_delta: Callable[[str, str], None] | None,
    ) -> ModelTurn:
        content_parts: list[str] = []
        reasoning_parts: list[str] = []
        slots: dict[int, dict[str, str]] = {}
        usage = Usage()
        finish_reason: str | None = None
        async for line in response.aiter_lines():
            line = line.strip()
            if not line.startswith("data:"):
                continue
            data = line[len("data:"):].strip()
            if data == "[DONE]":
                break
            try:
                chunk = json.loads(data)
            except json.JSONDecodeError:
                continue
            raw_usage = chunk.get("usage")
            if raw_usage:
                usage = Usage(
                    prompt_tokens=int(raw_usage.get("prompt_tokens") or 0),
                    completion_tokens=int(raw_usage.get("completion_tokens") or 0),
                )
            choices = chunk.get("choices") or []
            if not choices:
                continue
            choice = choices[0]
            if choice.get("finish_reason"):
                finish_reason = choice["finish_reason"]
            delta = choice.get("delta") or {}
            reasoning = delta.get("reasoning_content") or delta.get("reasoning")
            if not isinstance(reasoning, str):
                # 部分网关会把结构化 reasoning 塞进该字段，非字符串一律忽略。
                reasoning = None
            if reasoning:
                reasoning_parts.append(reasoning)
                if on_delta is not None:
                    on_delta("thinking", reasoning)
            content = delta.get("content")
            if not isinstance(content, str):
                content = None
            if content:
                content_parts.append(content)
                if on_delta is not None:
                    on_delta("content", content)
            for raw in delta.get("tool_calls") or []:
                slot = slots.setdefault(
                    raw.get("index", 0), {"id": "", "name": "", "arguments": ""}
                )
                slot["id"] = raw.get("id") or slot["id"]
                function = raw.get("function") or {}
                slot["name"] = function.get("name") or slot["name"]
                slot["arguments"] += function.get("arguments") or ""
        content, think = split_think("".join(content_parts) or None)
        reasoning_text = "".join(reasoning_parts) or None
        if think:
            reasoning_text = f"{reasoning_text}\n{think}" if reasoning_text else think
        calls: list[ToolCall] = []
        for index in sorted(slots):
            slot = slots[index]
            raw_arguments = slot["arguments"]
            try:
                arguments = json.loads(raw_arguments) if raw_arguments else {}
            except json.JSONDecodeError:
                arguments = None
            calls.append(
                ToolCall(
                    id=slot["id"] or f"call-{index}",
                    name=slot["name"],
                    arguments=arguments,
                    raw_arguments=raw_arguments,
                )
            )
        if finish_reason == "length":
            self.stats["truncations"] += 1
        return ModelTurn(
            content=content,
            reasoning=reasoning_text,
            tool_calls=calls,
            usage=usage,
            finish_reason=finish_reason,
        )

    async def _post(self, payload: dict[str, Any]) -> dict[str, Any]:
        last_error: str | None = None
        # 与 _open_stream 相同：默认退避 2+4+8=14s，覆盖 8-10s 限流窗口。
        for attempt in range(4):
            self.stats["requests"] += 1
            try:
                response = await self._client.post(
                    f"{self.base_url}/chat/completions",
                    json=payload,
                    headers=self._headers,
                )
            except httpx.TransportError as exc:
                last_error = str(exc) or f"request timed out after {self.timeout:g}s"
                if attempt < 3:
                    self.stats["retries"] += 1
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
                    self.stats["retries"] += 1
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
        reasoning = message.get("reasoning_content") or message.get("reasoning")
        content, think = split_think(message.get("content"))
        if think:
            reasoning = f"{reasoning}\n{think}" if reasoning else think
        finish_reason = choice.get("finish_reason")
        if finish_reason == "length":
            self.stats["truncations"] += 1
        return ModelTurn(
            content=content,
            reasoning=reasoning,
            tool_calls=calls,
            usage=Usage(
                prompt_tokens=int(usage.get("prompt_tokens") or 0),
                completion_tokens=int(usage.get("completion_tokens") or 0),
            ),
            raw=data,
            finish_reason=finish_reason,
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
