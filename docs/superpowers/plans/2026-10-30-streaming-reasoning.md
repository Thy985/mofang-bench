# 全流式 reasoning 评测链路（批次 1）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通"模型 thinking 全流式 → SSE 实时展示 → 落库 → 回放可查"全栈纵切，并让不支持流式的网关 auto 降级。

**Architecture:** adapter 层增加 `chat_stream()`（httpx 手动解析 SSE，tool_calls 分片重组，4xx 含 "stream" 自动降级非流式并记 `downgraded` 标记）；runner 侧以 `ThinkingThrottle` 合并 token 级增量为 `thinking.delta` SSE 事件，turn 结束把 thinking 全文随 `model.message` 事件与 `model_message` StepRecord（`steps.result_json`，零迁移）落库；前端 liveReducer 聚合增量、实时页/回放页渲染折叠 thinking 块；RunService 在 run 结束时把 auto 降级持久化进 provider `params_json`。

**Tech Stack:** Python 3.12 + httpx + FastAPI + pytest + respx；React 19 + Vite + Vitest + Testing Library + Playwright。

**Spec:** `docs/superpowers/specs/2026-10-30-streaming-reasoning-design.md`（本计划从 spec 论证，执行者需同时读两者）

## Global Constraints

- 后端测试命令：`uv run pytest -m "not slow"`；单测文件按现有分层放 `tests/models|runner|service/`。
- 前端验证命令（在 `frontend/` 下）：`npm run typecheck` → `npm run test:run` → `npm run build`。
- 不引入 openai SDK，SSE 用 `httpx` 手动解析；保持 `OpenAICompatibleAdapter` 零新依赖。
- 不改 `steps`/`episodes` 表结构（thinking 走 `steps.result_json`）。
- 非流式请求保持显式 `"stream": false`（passport：部分网关必须显式）。
- UI 文案中文；样式沿用现有语义 token 与既有写法（thinking 相关用 `text-sky-300`，与 ToolLog/RunLivePanel 现状一致）。
- 提交信息用中文、照 diff 现写，禁套历史标题；每任务一个提交。
- 系统提示词（`runner/context.py`）不动，`PROMPT_VERSION` 不 bump。

---

### Task 1: ModelTurn.reasoning 字段与非流式解析

**Files:**
- Modify: `src/mofang/models/provider.py`（ModelTurn）
- Modify: `src/mofang/models/openai_compat.py`（`_parse`、模块级 `split_think`）
- Test: `tests/models/test_openai_compat.py`

**Interfaces:**
- Consumes: 现有 `ModelTurn`、`OpenAICompatibleAdapter._parse(data: dict) -> ModelTurn`。
- Produces: `ModelTurn.reasoning: str | None`（后续所有任务依赖）；模块级函数 `split_think(content: str | None) -> tuple[str | None, str | None]`（返回 `(剩余正文, think 文本)`，Task 2 流式路径复用）。

- [ ] **Step 1: 写失败测试**

追加到 `tests/models/test_openai_compat.py`：

```python
@respx.mock
async def test_parses_reasoning_content(adapter: OpenAICompatibleAdapter) -> None:
    respx.post(f"{BASE}/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": "answer",
                            "reasoning_content": "step one\nstep two",
                        }
                    }
                ],
                "usage": {},
            },
        )
    )
    turn = await adapter.chat(
        [{"role": "user", "content": "go"}], [], ModelParams()
    )
    assert turn.reasoning == "step one\nstep two"
    assert turn.content == "answer"


@respx.mock
async def test_extracts_think_tags_from_content(
    adapter: OpenAICompatibleAdapter,
) -> None:
    respx.post(f"{BASE}/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": "<think>internal plan</think>final",
                        }
                    }
                ],
                "usage": {},
            },
        )
    )
    turn = await adapter.chat(
        [{"role": "user", "content": "go"}], [], ModelParams()
    )
    assert turn.reasoning == "internal plan"
    assert turn.content == "final"


@respx.mock
async def test_reasoning_merges_think_tags(
    adapter: OpenAICompatibleAdapter,
) -> None:
    respx.post(f"{BASE}/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": "<think>tag plan</think>ok",
                            "reasoning_content": "field plan",
                        }
                    }
                ],
                "usage": {},
            },
        )
    )
    turn = await adapter.chat(
        [{"role": "user", "content": "go"}], [], ModelParams()
    )
    assert turn.reasoning == "field plan\ntag plan"
    assert turn.content == "ok"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `uv run pytest tests/models/test_openai_compat.py -v -k reasoning or think`
Expected: FAIL（`ModelTurn` 无 `reasoning` 属性 / assertion None）

- [ ] **Step 3: 最小实现**

`src/mofang/models/provider.py` 的 `ModelTurn` 增加一个字段（放在 `content` 之后）：

```python
@dataclass
class ModelTurn:
    content: str | None = None
    reasoning: str | None = None
    tool_calls: list[ToolCall] = field(default_factory=list)
    usage: Usage = field(default_factory=Usage)
    raw: dict[str, Any] = field(default_factory=dict)
    finish_reason: str | None = None
```

`src/mofang/models/openai_compat.py`：文件头加 `import re`，`decode_json` 之后加：

```python
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
```

`_parse` 中取 message 之后、构造 `ModelTurn` 之前加：

```python
        reasoning = message.get("reasoning_content") or message.get("reasoning")
        content, think = split_think(message.get("content"))
        if think:
            reasoning = f"{reasoning}\n\n{think}" if reasoning else think
```

`ModelTurn(...)` 构造处加 `reasoning=reasoning,`（放在 `content=content,` 后）。

- [ ] **Step 4: 跑测试确认通过**

Run: `uv run pytest tests/models/test_openai_compat.py -v`
Expected: 全部 PASS（含原有用例）

- [ ] **Step 5: 提交**

```bash
git add src/mofang/models/provider.py src/mofang/models/openai_compat.py tests/models/test_openai_compat.py
git commit -m "feat: ModelTurn 增加 reasoning 字段，非流式解析 reasoning_content 与 <think> 剥离"
```

---

### Task 2: adapter 流式路径 chat_stream + auto 降级

**Files:**
- Modify: `src/mofang/models/openai_compat.py`
- Test: `tests/models/test_openai_compat.py`

**Interfaces:**
- Consumes: Task 1 的 `ModelTurn.reasoning`、`split_think`；现有 `ProviderError`、`ToolCall`、`Usage`。
- Produces:
  - `OpenAICompatibleAdapter.__init__(..., stream: bool = True)`，实例属性 `self.stream: bool`、`self.downgraded: bool`（初始 False）。
  - `async def chat_stream(self, messages, tools, params, on_delta=None) -> ModelTurn`，其中 `on_delta: Callable[[str, str], None]`，phase 取值 `"thinking" | "content"`，text 为增量片段。
  - 降级行为契约：`stream=False` 时 `chat_stream` 直接走非流式（不置 `downgraded`）；流式 4xx 且报错文本含 "stream" 时置 `downgraded=True` 并走非流式；流中断抛 `ProviderError("transport", ..., retryable=False)`。

- [ ] **Step 1: 写失败测试**

追加到 `tests/models/test_openai_compat.py`。先在文件头补 import：

```python
from mofang.models.provider import ModelTurn  # 若已存在则并入现有 import 行
```

测试代码：

```python
def _sse(*chunks: dict) -> bytes:
    frames = [f"data: {json.dumps(c, ensure_ascii=False)}\n\n" for c in chunks]
    frames.append("data: [DONE]\n\n")
    return "".join(frames).encode("utf-8")


USAGE = {"prompt_tokens": 10, "completion_tokens": 5}


@respx.mock
async def test_stream_accumulates_reasoning_and_content(
    adapter: OpenAICompatibleAdapter,
) -> None:
    respx.post(f"{BASE}/chat/completions").mock(
        return_value=httpx.Response(
            200,
            content=_sse(
                {"choices": [{"delta": {"role": "assistant"}}]},
                {"choices": [{"delta": {"reasoning_content": "think "}}]},
                {"choices": [{"delta": {"reasoning": "hard"}}]},
                {"choices": [{"delta": {"content": "do "}}]},
                {"choices": [{"delta": {"content": "R'"}}]},
                {"choices": [{"delta": {}, "finish_reason": "stop"}]},
                {"choices": [], "usage": USAGE},
            ),
        )
    )
    deltas: list[tuple[str, str]] = []
    turn = await adapter.chat_stream(
        [{"role": "user", "content": "go"}],
        [],
        ModelParams(),
        on_delta=lambda phase, text: deltas.append((phase, text)),
    )
    assert turn.reasoning == "think hard"
    assert turn.content == "do R'"
    assert turn.usage.prompt_tokens == 10
    assert deltas == [
        ("thinking", "think "),
        ("thinking", "hard"),
        ("content", "do "),
        ("content", "R'"),
    ]


@respx.mock
async def test_stream_reassembles_tool_call_fragments(
    adapter: OpenAICompatibleAdapter,
) -> None:
    respx.post(f"{BASE}/chat/completions").mock(
        return_value=httpx.Response(
            200,
            content=_sse(
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
                                            "arguments": '{"moves": ',
                                        },
                                    }
                                ]
                            }
                        }
                    ]
                },
                {
                    "choices": [
                        {
                            "delta": {
                                "tool_calls": [
                                    {
                                        "index": 0,
                                        "function": {"arguments": '["R\'"]}'},
                                    }
                                ]
                            }
                        }
                    ]
                },
                {"choices": [{"delta": {}, "finish_reason": "tool_calls"}]},
                {"choices": [], "usage": USAGE},
            ),
        )
    )
    turn = await adapter.chat_stream(
        [{"role": "user", "content": "go"}], [], ModelParams()
    )
    assert turn.tool_calls[0].name == "apply_moves"
    assert turn.tool_calls[0].arguments == {"moves": ["R'"]}
    assert turn.finish_reason == "tool_calls"


@respx.mock
async def test_stream_downgrades_on_stream_error(
    adapter: OpenAICompatibleAdapter,
) -> None:
    route = respx.post(f"{BASE}/chat/completions")
    route.side_effect = [
        httpx.Response(400, json={"error": {"message": "stream is not supported"}}),
        httpx.Response(
            200,
            json={
                "choices": [
                    {"message": {"content": "ok", "reasoning_content": "hmm"}}
                ],
                "usage": USAGE,
            },
        ),
    ]
    turn = await adapter.chat_stream(
        [{"role": "user", "content": "go"}], [], ModelParams()
    )
    assert adapter.downgraded is True
    assert turn.content == "ok"
    assert turn.reasoning == "hmm"


async def test_stream_disabled_uses_non_stream() -> None:
    received: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        received.append(body)
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "ok"}}],
                "usage": USAGE,
            },
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    adapter = OpenAICompatibleAdapter(
        base_url=BASE,
        api_key="secret",
        model="test-model",
        client=client,
        stream=False,
    )
    turn = await adapter.chat_stream(
        [{"role": "user", "content": "go"}], [], ModelParams()
    )
    await client.aclose()
    assert received[0]["stream"] is False
    assert turn.content == "ok"
    assert adapter.downgraded is False


async def test_stream_interrupted_raises_non_retryable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        async def broken() -> Any:
            yield b"data: "
            raise httpx.ReadError("connection lost")

        return httpx.Response(200, content=broken())

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    adapter = OpenAICompatibleAdapter(
        base_url=BASE,
        api_key="secret",
        model="test-model",
        client=client,
        retry_delay=0,
    )
    try:
        with pytest.raises(ProviderError) as exc_info:
            await adapter.chat_stream(
                [{"role": "user", "content": "go"}], [], ModelParams()
            )
        assert exc_info.value.kind == "transport"
        assert exc_info.value.retryable is False
    finally:
        await client.aclose()
```

（`Any` 需在文件头 `from typing import Any`。）

- [ ] **Step 2: 跑测试确认失败**

Run: `uv run pytest tests/models/test_openai_compat.py -v -k stream`
Expected: FAIL（`chat_stream` 不存在 / `stream` 构造参数不存在）

- [ ] **Step 3: 最小实现**

`src/mofang/models/openai_compat.py`：

3a. `__init__` 签名加 `*, stream: bool = True`（放在 `timeout` 之后的 keyword-only 区），并加两个实例属性：

```python
        self.stream = stream
        self.downgraded = False
```

3b. 抽出 payload 构造（`chat` 改用它，行为不变）：

```python
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
        payload.update(params.extra)
        if payload.get("stream"):
            payload["stream_options"] = {"include_usage": True}
        return payload
```

`chat()` 体改为：

```python
        payload = self._build_payload(messages, tools, params, stream=False)
        response = await self._post(payload)
        return self._parse(response)
```

3c. `chat_stream` 与流消费（放在 `chat` 与 `_post` 之间）：

```python
    async def chat_stream(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        params: ModelParams,
        on_delta: Callable[[str, str], None] | None = None,
    ) -> ModelTurn:
        if not self.stream:
            return await self.chat(messages, tools, params)
        payload = self._build_payload(messages, tools, params, stream=True)
        response = await self._open_stream(payload)
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

    async def _open_stream(
        self, payload: dict[str, Any]
    ) -> httpx.Response | None:
        """打开流式响应；返回 None 表示网关不支持流式（应降级）。"""
        last_error: str | None = None
        for attempt in range(4):
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
            if reasoning:
                reasoning_parts.append(reasoning)
                if on_delta is not None:
                    on_delta("thinking", reasoning)
            content = delta.get("content")
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
            reasoning_text = (
                f"{reasoning_text}\n\n{think}" if reasoning_text else think
            )
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
        return ModelTurn(
            content=content,
            reasoning=reasoning_text,
            tool_calls=calls,
            usage=usage,
            finish_reason=finish_reason,
        )
```

文件头补 `from typing import Any, Callable`。

- [ ] **Step 4: 跑测试确认通过**

Run: `uv run pytest tests/models/test_openai_compat.py -v`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/mofang/models/openai_compat.py tests/models/test_openai_compat.py
git commit -m "feat: adapter 增加 chat_stream 流式解析、tool_calls 分片重组与 4xx auto 降级"
```

---

### Task 3: provider 流式开关接入 build_adapter

**Files:**
- Modify: `src/mofang/models/openai_compat.py`（无改动，仅确认 Task 2 已带 `stream` 参数）
- Modify: `src/mofang/service/factory.py`（`build_adapter`）
- Test: `tests/service/test_factory.py`（若已有对应文件则追加；没有则新建）

**Interfaces:**
- Consumes: Task 2 的 `OpenAICompatibleAdapter(..., stream=...)`；`ProviderRecord.params`（`store/providers.py:27`）。
- Produces: `build_adapter` 契约——provider `params` 里 `"stream": false` 时构造的 adapter `stream` 为 False，默认 True。Task 4 的 runner 与 Task 5 的持久化依赖此契约。

- [ ] **Step 1: 写失败测试**

在 `tests/service/test_factory.py`（不存在则新建，参考现有 service 测试的 import 风格）：

```python
from mofang.service.factory import build_adapter
from mofang.store.providers import ProviderRecord


def _record(params: dict) -> ProviderRecord:
    import json

    return ProviderRecord(
        id="p1",
        name="n",
        base_url="http://127.0.0.1:9/v1",
        model="m",
        api_key_ref="K",
        params_json=json.dumps(params),
        created_at="now",
        api_key="k",
    )


def test_build_adapter_stream_default_on() -> None:
    adapter = build_adapter(_record({}), env={"K": "k"})
    assert adapter.stream is True


def test_build_adapter_stream_off_from_params() -> None:
    adapter = build_adapter(_record({"stream": False}), env={"K": "k"})
    assert adapter.stream is False
```

- [ ] **Step 2: 跑测试确认失败**

Run: `uv run pytest tests/service/test_factory.py -v`
Expected: FAIL（`TypeError: unexpected keyword 'stream'` 或 `stream` 属性缺失）

- [ ] **Step 3: 最小实现**

`src/mofang/service/factory.py` 的 `build_adapter` 返回处改为：

```python
    return OpenAICompatibleAdapter(
        base_url=record.base_url,
        api_key=key,
        model=record.model,
        stream=bool(record.params.get("stream", True)),
    )
```

- [ ] **Step 4: 跑测试确认通过**

Run: `uv run pytest tests/service/test_factory.py tests/models/test_openai_compat.py -v`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/mofang/service/factory.py tests/service/test_factory.py
git commit -m "feat: provider params 支持 stream 开关，build_adapter 透传给 adapter"
```

---

### Task 4: runner 流式接入——节流、thinking.delta、model.message/StepRecord 扩展

**Files:**
- Modify: `src/mofang/runner/episode.py`
- Test: `tests/runner/test_episode_thinking.py`（新建）

**Interfaces:**
- Consumes: Task 1 `ModelTurn.reasoning`；Task 2 `chat_stream(messages, tools, params, on_delta)`。
- Produces（后续任务与前端依赖的事件契约）：
  - 新事件 `thinking.delta`，payload `{"seq": <turn 序号 int>, "text": <增量 str>}`，经 service emit 桥自动携带 `episode_id`。
  - `model.message` payload 新增 `"thinking": str | None`。
  - `model_message` StepRecord 的 `result` 变为 `{"content": ..., "thinking": ...}`。

- [ ] **Step 1: 写失败测试**

新建 `tests/runner/test_episode_thinking.py`（导入路径参考 `tests/runner/` 现有测试；FakeProvider 来自 `mofang.models.provider`，Task 与预算构造参考 `tests/runner/test_episode.py` 现有用法）：

```python
import asyncio

from mofang.models.provider import ModelParams, ModelTurn
from mofang.runner.episode import EpisodeRunner
from tests.runner.test_episode import (  # 复用现有测试的任务/求解器 fixture
    make_runner_env,  # 若该 fixture 名不同，以现有文件实际导出为准
)


class StreamingFakeProvider:
    def __init__(self) -> None:
        self.calls = 0

    async def chat(self, messages, tools, params) -> ModelTurn:
        raise AssertionError("streaming provider must use chat_stream")

    async def chat_stream(self, messages, tools, params, on_delta=None) -> ModelTurn:
        self.calls += 1
        if self.calls == 1:
            if on_delta is not None:
                on_delta("thinking", "aa")
                on_delta("thinking", "bb")
                on_delta("content", "hi")
            return ModelTurn(
                content="hi",
                reasoning="aabb",
                tool_calls=[],
            )
        if on_delta is not None:
            on_delta("thinking", "second turn thought")
        return ModelTurn(
            content=None,
            reasoning="second turn thought",
            tool_calls=[],
        )

    async def probe_tools(self) -> bool:
        return True


async def test_thinking_deltas_and_message_payload(monkeypatch) -> None:
    env = make_runner_env(provider=StreamingFakeProvider())
    events: list[tuple[str, dict]] = []
    result = await env.runner.run(env.task, emit=lambda kind, payload: events.append((kind, payload)))
    kinds = [kind for kind, _ in events]
    assert "thinking.delta" in kinds
    deltas = [payload for kind, payload in events if kind == "thinking.delta"]
    assert deltas[0]["seq"] == 0
    assert "".join(d["text"] for d in deltas) == "aabb"
    message = next(payload for kind, payload in events if kind == "model.message")
    assert message["thinking"] == "aabb"
    # 第二个 turn：无工具调用会触发 nudge，seq 递增
    message2 = [p for k, p in events if k == "model.message"][1]
    assert message2["thinking"] == "second turn thought"
    steps = result.steps
    assert steps[0].result["thinking"] == "aabb"
    assert steps[0].result["content"] == "hi"


async def test_throttle_merges_small_deltas(monkeypatch) -> None:
    from mofang.runner.episode import ThinkingThrottle

    out: list[dict] = []
    throttle = ThinkingThrottle(
        lambda kind, payload: out.append(payload), seq=3, max_chars=64
    )
    for ch in "abcdefgh":  # 8 次 1 字符增量，均低于 64 字符阈值
        throttle("thinking", ch)
    assert out == []
    throttle.flush()
    assert len(out) == 1
    assert out[0]["seq"] == 3
    assert out[0]["text"] == "abcdefgh"
```

注意：`make_runner_env` 是占位约定——实现 Step 3 前先打开 `tests/runner/test_episode.py`，若其任务/runner 构造方式是模块级函数或 fixture，直接复用同样的构造方式，把 `provider` 换成 `StreamingFakeProvider()`、`params` 用 `ModelParams()`；不要新造平行构造。`StreamingFakeProvider` 第二个 turn 返回无工具调用的 turn，会走现有 nudge 路径（`MAX_NUDGES=2`），episode 以 `stopped_unsolved` 结束——这正好让两条 `model.message` 都发生。

- [ ] **Step 2: 跑测试确认失败**

Run: `uv run pytest tests/runner/test_episode_thinking.py -v`
Expected: FAIL（`ThinkingThrottle` 不存在；事件里无 `thinking.delta`）

- [ ] **Step 3: 最小实现**

`src/mofang/runner/episode.py`：

3a. 模块级新增（放在 `_EpisodeCancelled` 之前）：

```python
class ThinkingThrottle:
    """把 token 级 thinking 增量按字符数/时间间隔合并成事件，防止事件总线膨胀。"""

    def __init__(
        self,
        notify: Callable[[str, dict[str, Any]], None],
        seq: int,
        max_chars: int = 64,
        max_interval: float = 0.15,
    ) -> None:
        self._notify = notify
        self._seq = seq
        self._max_chars = max_chars
        self._max_interval = max_interval
        self._pending: list[str] = []
        self._last = time.monotonic()

    def __call__(self, phase: str, text: str | None) -> None:
        if phase != "thinking" or not text:
            return
        self._pending.append(text)
        total = sum(len(part) for part in self._pending)
        if (
            total >= self._max_chars
            or time.monotonic() - self._last >= self._max_interval
        ):
            self.flush()

    def flush(self) -> None:
        if not self._pending:
            return
        text = "".join(self._pending)
        self._pending.clear()
        self._last = time.monotonic()
        self._notify("thinking.delta", {"seq": self._seq, "text": text})
```

3b. `_chat` 增加回调参数并支持流式（替换现 `episode.py:102-131` 的方法体首部）：

```python
    async def _chat(
        self,
        messages: list[dict[str, Any]],
        cancel: asyncio.Event | None,
        on_delta: Callable[[str, str], None] | None = None,
    ) -> ModelTurn:
        stream_chat = getattr(self.provider, "chat_stream", None)
        if stream_chat is not None and on_delta is not None:
            chat = asyncio.create_task(
                stream_chat(messages, self._tools(), self.params, on_delta)
            )
        else:
            chat = asyncio.create_task(
                self.provider.chat(messages, self._tools(), self.params)
            )
```

（其余 `asyncio.wait` / cancel / timeout 逻辑原样保留。）

3c. `run()` 的 turn 循环内，`notify("model.turn.started", ...)` 之前构造节流器，`_chat` 调用传入，turn 结束后 flush：

```python
            throttle = ThinkingThrottle(notify, seq=len(records))
```

```python
                turn = await self._chat(messages, cancel, on_delta=throttle)
```

`_chat` 正常返回后（`nudge = None` 之后、tokens 累计之前任意位置）加：

```python
            throttle.flush()
```

3d. `model.message` 事件与 StepRecord 扩展（现 `episode.py:203-229`）：

```python
            notify(
                "model.message",
                {
                    "content": turn.content,
                    "thinking": turn.reasoning,
                    "tool_calls": len(turn.tool_calls),
                    "usage": {
                        "prompt_tokens": tokens_in,
                        "completion_tokens": tokens_out,
                    },
                },
            )
```

```python
            steps.append(
                StepRecord(
                    seq=len(steps),
                    kind="model_message",
                    arguments={
                        "tool_calls": [call.name for call in turn.tool_calls]
                    },
                    result={"content": turn.content, "thinking": turn.reasoning},
                    state=executor.state.to_json(),
                    reference_length_after=self.solver.distance(executor.state),
                )
            )
```

- [ ] **Step 4: 跑测试确认通过**

Run: `uv run pytest tests/runner tests/models -v`
Expected: 全部 PASS（含既有 episode 测试——FakeProvider 无 `chat_stream`，走非流式回退）

- [ ] **Step 5: 提交**

```bash
git add src/mofang/runner/episode.py tests/runner/test_episode_thinking.py
git commit -m "feat: runner 接入流式 thinking，节流发 thinking.delta，message/StepRecord 携带 thinking"
```

---

### Task 5: auto 降级持久化到 provider params

**Files:**
- Modify: `src/mofang/store/providers.py`（新增 `set_provider_param`）
- Modify: `src/mofang/service/runs.py`（`_execute_locked` finally）
- Test: `tests/store/test_providers_params.py`（新建）、`tests/service/test_run_downgrade.py`（新建）

**Interfaces:**
- Consumes: Task 2 的 `adapter.downgraded` 标记；`RunService._execute_locked` 现有 finally 块（`service/runs.py:164-171`）。
- Produces: `set_provider_param(db: Database, provider_id: str, key: str, value: Any) -> ProviderRecord | None`。Task 3 的 `stream` 参数即从这里的 `params_json` 读回。

- [ ] **Step 1: 写失败测试**

`tests/store/test_providers_params.py`（db fixture 参考 `tests/store/` 现有测试；若现有文件有 `db` fixture 则 import 复用，不要复制建库代码）：

```python
from mofang.store.providers import (
    create_provider,
    get_provider,
    set_provider_param,
)


def test_set_provider_param_merges_and_persists(db) -> None:
    record = create_provider(
        db,
        name="p",
        base_url="http://127.0.0.1:9/v1",
        model="m",
        api_key_ref="K",
        params={"temperature": 0.5},
    )
    updated = set_provider_param(db, record.id, "stream", False)
    assert updated is not None
    assert updated.params == {"temperature": 0.5, "stream": False}
    assert get_provider(db, record.id).params["stream"] is False


def test_set_provider_param_missing_returns_none(db) -> None:
    assert set_provider_param(db, "nope", "stream", False) is None
```

`tests/service/test_run_downgrade.py`（run 启动方式参考 `tests/service/` 现有 run 测试——用同样的 db/events/provider_factory 注入方式；核心断言如下）：

```python
class DowngradingAdapter:
    downgraded = True

    async def chat(self, messages, tools, params):
        from mofang.models.provider import ModelTurn

        return ModelTurn(content=None)

    async def probe_tools(self) -> bool:
        return True


async def test_downgrade_persisted_to_provider_params(service_env) -> None:
    # service_env：以 DowngradingAdapter 为 provider_factory 产物的最小 run 环境，
    # 构造方式与现有 service run 测试一致（FakeProvider 换成 DowngradingAdapter）。
    ...
    await service_env.service.wait(service_env.run_id)
    record = service_env.provider  # get_provider(db, provider_id) 的结果
    assert record.params["stream"] is False


async def test_no_downgrade_keeps_params(service_env_clean) -> None:
    # provider_factory 返回普通 FakeProvider（无 downgraded 属性）
    ...
    record = service_env_clean.provider
    assert "stream" not in record.params
```

实现 Step 3 前先打开 `tests/service/` 下现有 run 测试，照抄其环境构造（db、RunEventBus、provider_factory、benchmark 冻结数据、start/wait），只替换 adapter；上面 `...` 处以实际构造代码填充，禁止保留占位。

- [ ] **Step 2: 跑测试确认失败**

Run: `uv run pytest tests/store/test_providers_params.py tests/service/test_run_downgrade.py -v`
Expected: FAIL（`set_provider_param` 不存在；params 未更新）

- [ ] **Step 3: 最小实现**

`src/mofang/store/providers.py` 末尾追加：

```python
def set_provider_param(
    db: Database, provider_id: str, key: str, value: Any
) -> ProviderRecord | None:
    record = get_provider(db, provider_id)
    if record is None:
        return None
    params = record.params
    params[key] = value
    with db.transaction() as conn:
        conn.execute(
            "UPDATE providers SET params_json = ? WHERE id = ?",
            (json.dumps(params, ensure_ascii=False), provider_id),
        )
    return get_provider(db, provider_id)
```

`src/mofang/service/runs.py`：import 区加 `set_provider_param`（并入现有 `from ..store.providers import ...` 行）；`_execute_locked` 的 finally 块开头（`service/runs.py:164`，`close = getattr(...)` 之前）加：

```python
        finally:
            if (
                adapter is not None
                and provider is not None
                and getattr(adapter, "downgraded", False)
            ):
                set_provider_param(self.db, provider.id, "stream", False)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `uv run pytest tests/store tests/service -v`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/mofang/store/providers.py src/mofang/service/runs.py tests/store/test_providers_params.py tests/service/test_run_downgrade.py
git commit -m "feat: 流式 auto 降级在 run 结束后持久化为 provider stream=false"
```

---

### Task 6: 前端类型、EVENT_TYPES 注册与 liveReducer 聚合

**Files:**
- Modify: `frontend/src/api/types.ts:236-239`（model.message 载荷）与 `types.ts:229-280`（新增 thinking.delta 分支）
- Modify: `frontend/src/hooks/useRunEvents.ts:10-21`
- Modify: `frontend/src/hooks/liveReducer.ts`
- Test: `frontend/src/hooks/liveReducer.test.ts`（追加；文件名以现有 reducer 测试实际名为准）

**Interfaces:**
- Consumes: Task 4 的事件契约（`thinking.delta {seq, text}`、`model.message.thinking`）。
- Produces:
  - `LiveState.thinkingText: string`（当前 turn 流式 thinking 缓冲）。
  - `LiveLog` 增加 `thinking?: string | null`（Task 7 的 ToolLog 渲染依赖）。

- [ ] **Step 1: 写失败测试**

在现有 liveReducer 测试文件追加（动作构造方式照抄该文件现有 event 工厂）：

```ts
it('thinking.delta 追加缓冲，model.message 归档全文并清空', () => {
  let state = initialLiveState()
  state = liveReducer(state, { type: 'connection', connection: 'open' })
  state = liveReducer(state, {
    type: 'event',
    event: {
      id: 1,
      type: 'episode.started',
      run_id: 'r1',
      episode_id: 'e1',
      ts: 't',
      data: { task_id: 'b:t1', reference_length: 4 },
    },
  })
  state = liveReducer(state, {
    type: 'event',
    event: {
      id: 2,
      type: 'thinking.delta',
      run_id: 'r1',
      episode_id: 'e1',
      ts: 't',
      data: { seq: 0, text: '先看 ' },
    },
  })
  state = liveReducer(state, {
    type: 'event',
    event: {
      id: 3,
      type: 'thinking.delta',
      run_id: 'r1',
      episode_id: 'e1',
      ts: 't',
      data: { seq: 0, text: '白面' },
    },
  })
  expect(state.thinkingText).toBe('先看 白面')
  state = liveReducer(state, {
    type: 'event',
    event: {
      id: 4,
      type: 'model.message',
      run_id: 'r1',
      episode_id: 'e1',
      ts: 't',
      data: {
        content: '使用 apply_moves',
        thinking: '先看 白面，再转',
        tool_calls: 1,
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      },
    },
  })
  expect(state.thinkingText).toBe('')
  expect(state.logs.at(-1)?.thinking).toBe('先看 白面，再转')
})
```

- [ ] **Step 2: 跑测试确认失败**

Run（`frontend/` 下）: `npm run test:run -- liveReducer`
Expected: FAIL（无 `thinkingText`；`model.message` 无 thinking 归档）

- [ ] **Step 3: 最小实现**

3a. `frontend/src/api/types.ts`：`model.message` 分支 data 改为
`{ content: string | null; thinking?: string | null; tool_calls: number; usage: Usage }`；
`run.error` 分支之前插入：

```ts
  | RunEventBase<'thinking.delta', { seq: number; text: string }>
```

3b. `frontend/src/hooks/useRunEvents.ts` 的 `EVENT_TYPES` 数组中，`'model.message'` 之后加 `'thinking.delta',`。

3c. `frontend/src/hooks/liveReducer.ts`：

- `LiveLog` 增加字段：`thinking?: string | null`。
- `LiveState` 增加字段：`thinkingText: string`；`initialLiveState()` 加 `thinkingText: ''`。
- `snapshot` 动作 `reset` 分支与 `episode.started` case 里都加 `thinkingText: ''`。
- `model.turn.started` case 改为：

```ts
    case 'model.turn.started':
      return { ...next, thinking: true, thinkingText: '' }
```

- 新增 case（放在 `model.message` 之前）：

```ts
    case 'thinking.delta':
      return {
        ...next,
        thinkingText: state.thinkingText + event.data.text,
      }
```

- `model.message` case 中 log 条目补 thinking（以事件全文为权威，缺省回退缓冲）：

```ts
    case 'model.message': {
      const entry = {
        id: event.id,
        kind: 'model' as const,
        text: event.data.content ?? '',
        data: event.data,
        thinking: event.data.thinking ?? (state.thinkingText || null),
      }
      const logs = event.data.content
        ? [...state.logs, entry]
        : state.logs
      return {
        ...next,
        logs,
        usage: event.data.usage,
        thinking: false,
        thinkingText: '',
      }
    }
```

- [ ] **Step 4: 跑测试与类型检查确认通过**

Run（`frontend/` 下）: `npm run typecheck && npm run test:run`
Expected: 全部 PASS（`useRunEvents.test.ts` 若对新事件类型有穷举断言需同步补 `'thinking.delta'`）

- [ ] **Step 5: 提交**

```bash
git add frontend/src/api/types.ts frontend/src/hooks/useRunEvents.ts frontend/src/hooks/liveReducer.ts frontend/src/hooks
git commit -m "feat: 前端消费 thinking.delta，liveReducer 聚合流式 thinking 并归档到日志"
```

---

### Task 7: 前端 UI——实时 thinking 面板、ToolLog 思考块、回放思考块

**Files:**
- Modify: `frontend/src/pages/RunPage.tsx:112-116`（RunLivePanel 的 thinking 区）
- Modify: `frontend/src/components/ToolLog.tsx`
- Modify: `frontend/src/pages/EpisodePage.tsx:147-162`（step 详情区）
- Test: `frontend/src/pages/RunPage.test.tsx`（追加）、`frontend/src/pages/EpisodePage.test.tsx`（追加）

**Interfaces:**
- Consumes: Task 6 的 `LiveState.thinkingText`、`LiveLog.thinking`；steps 接口里 `model_message` 步骤的 `result.thinking`（Task 4 落库，`GET /api/episodes/{id}/steps` 原样透出，无需改 API）。
- Produces: testid `thinking-panel`（实时流式面板）、`log-thinking`（ToolLog 内思考块）、`step-thinking`（回放页思考块）——Task 8 的 E2E 断言依赖。

- [ ] **Step 1: 写失败测试**

`RunPage.test.tsx` 追加（事件注入方式照抄该文件现有模式）：

```tsx
it('流式 thinking 实时渲染到思考面板，结束后归档', async () => {
  // 1) 用现有测试的事件流工厂派发 episode.started → model.turn.started
  // 2) 派发 thinking.delta { seq: 0, text: '推理片段' }
  // 3) 断言 document 内出现 data-testid="thinking-panel" 且文本含 '推理片段'
  // 4) 派发 model.message（带 thinking: '推理片段 全文'）
  // 5) 断言 thinking-panel 消失，tool-log 中出现 data-testid="log-thinking" 且含 '推理片段 全文'
})
```

（照抄现有 RunPage.test.tsx 的 render/事件 helper；上图为断言骨架，实现时以现有 helper 填充完整事件序列，禁止留注释占位。）

`EpisodePage.test.tsx` 追加：

```tsx
it('model_message 步骤展示思考块', async () => {
  // 现有 steps mock 中，给某个 model_message 步骤的 result 增加
  // thinking: '回放思考文本'；选中该步后断言 data-testid="step-thinking" 出现且含该文本。
})
```

- [ ] **Step 2: 跑测试确认失败**

Run（`frontend/` 下）: `npm run test:run -- RunPage EpisodePage`
Expected: FAIL（无 `thinking-panel` / `log-thinking` / `step-thinking`）

- [ ] **Step 3: 最小实现**

3a. `RunPage.tsx` 把现 `RunLivePanel` 的：

```tsx
      {live.thinking && (
        <p data-testid="thinking" className="text-sky-300">
          思考中…
        </p>
      )}
```

改为：

```tsx
      {live.thinking && !live.thinkingText && (
        <p data-testid="thinking" className="text-sky-300">
          思考中…
        </p>
      )}
      {live.thinking && live.thinkingText && (
        <details open data-testid="thinking-panel">
          <summary className="cursor-pointer text-sky-300">思考中…</summary>
          <pre className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded bg-sunken p-2 text-xs text-text-dim">
            {live.thinkingText}
          </pre>
        </details>
      )}
```

3b. `ToolLog.tsx` 的 `<details>` 内、`<pre>` 之前插入思考块：

```tsx
            {log.kind === 'model' && log.thinking && (
              <details data-testid="log-thinking" className="mt-1">
                <summary className="cursor-pointer text-sky-300">
                  思考过程
                </summary>
                <pre className="mt-1 overflow-auto whitespace-pre-wrap rounded bg-sunken p-2 text-[10px] text-text-dim">
                  {log.thinking}
                </pre>
              </details>
            )}
```

3c. `EpisodePage.tsx` 的 step 详情区（"结果" details 之前）插入：

```tsx
              {typeof step.result?.thinking === 'string' &&
                step.result.thinking && (
                  <details data-testid="step-thinking">
                    <summary className="cursor-pointer text-xs text-sky-300">
                      思考过程
                    </summary>
                    <pre className="mt-1 overflow-auto whitespace-pre-wrap rounded bg-sunken p-2 text-[10px] text-text-dim">
                      {step.result.thinking as string}
                    </pre>
                  </details>
                )}
```

（`step.result` 类型为 `Record<string, unknown> | null`，`thinking` 需断言；若 typecheck 报类型收窄问题，用 `(step.result?.thinking as string | undefined)`。）

- [ ] **Step 4: 跑全部前端验证**

Run（`frontend/` 下）: `npm run typecheck && npm run test:run && npm run build`
Expected: 全部 PASS，构建成功

- [ ] **Step 5: 提交**

```bash
git add frontend/src/pages/RunPage.tsx frontend/src/components/ToolLog.tsx frontend/src/pages/EpisodePage.tsx frontend/src/pages/RunPage.test.tsx frontend/src/pages/EpisodePage.test.tsx
git commit -m "feat: 实时/日志/回放三处渲染 thinking 折叠块"
```

---

### Task 8: fake server 流式支持、E2E 断言与文档

**Files:**
- Modify: `scripts/fake_openai_server.py`
- Modify: `tests/test_fake_openai_server.py`
- Modify: `frontend/e2e/workbench.spec.ts`
- Modify: `README.md`、`PROJECT-PASSPORT.md`

**Interfaces:**
- Consumes: Task 4/7 的事件契约与 testid（`thinking-panel`、`log-thinking`、`step-thinking`）。
- Produces: fake 服务器在 `"stream": true` 时返回 SSE 分帧（含 `reasoning_content` delta 与 tool_calls 参数分片），E2E 全链路覆盖；文档反映新行为。

- [ ] **Step 1: fake server 失败测试**

`tests/test_fake_openai_server.py` 追加（HTTP 调用方式照抄现有用例）：

```python
def test_stream_payload_returns_sse() -> None:
    # 照现有用例起服务器线程，POST payload 带 "stream": True、tools 含 apply_moves
    import json
    import urllib.request

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
```

（`base_url` 用现有用例的端口/起服方式；上图为断言骨架，实现时按该文件现有 helper 填充。）

Run: `uv run pytest tests/test_fake_openai_server.py -v`
Expected: FAIL（当前服务器只回 JSON）

- [ ] **Step 2: fake server 实现**

`scripts/fake_openai_server.py`：

2a. 模块级新增（`build_completion` 之后）：

```python
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
```

2b. `do_POST` 中 `payload` 解析后、`self._json(...)` 处改为：

```python
        if payload.get("stream"):
            raw = build_stream_frames(payload, self.moves)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        self._json(build_completion(payload, self.moves))
```

Run: `uv run pytest tests/test_fake_openai_server.py tests/models/test_openai_compat.py -v`
Expected: 全部 PASS

- [ ] **Step 3: E2E 断言**

`frontend/e2e/workbench.spec.ts`：在现有 run 场景中（启动 run 之后、进入结果页之前）插入：

```ts
      await expect(page.getByTestId('thinking-panel')).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.getByTestId('log-thinking').first()).toBeVisible()
```

在现有 episode 回放步骤中（进入回放页并选中 model_message 步骤之后）插入：

```ts
      const stepThinking = page.getByTestId('step-thinking')
      if (await stepThinking.count()) {
        await stepThinking.first().locator('summary').click()
        await expect(stepThinking.first()).toContainText(/./)
      }
```

（回放 thinking 的断言用条件式，因为模型解出时的短回放可能无 thinking；`log-thinking` 是硬断言——fake 服务器每 turn 都发 thinking。）

- [ ] **Step 4: 跑 E2E**

Run（`frontend/` 下）: `npm run e2e`
Expected: 全链路 PASS（三个自举进程正常，无控制台错误）

- [ ] **Step 5: 文档更新**

`README.md`「真实模型」节后追加一小节：

```markdown
### 流式 thinking

Provider 默认以 `stream: true` 请求，模型的思考过程（`reasoning_content`
或 `<think>` 段）会实时流到 run 页面的思考面板，并随每个 turn 落库，
回放页可展开查看。网关不支持流式时（4xx 报错含 stream）自动降级为
非流式并把该 provider 记为 `stream: false`；如需强制非流式，在
provider 参数里设 `"stream": false`。
```

`PROJECT-PASSPORT.md`：已知限制列表追加一行：

```markdown
- 流式兼容：auto 降级只识别“4xx 且报错含 stream”一种信号；其余网关
  流式怪癖仍需 `params.extra` 手工兜。流中断不重试（防 usage 双计），
  直接以 provider_error 终止该 episode。
```

并把"更新"日期行改为 `2026-10-30`、阶段行补"批次 1（全流式 reasoning）完成"。

- [ ] **Step 6: 最终验证与提交**

```bash
uv run pytest -m "not slow"
cd frontend && npm run typecheck && npm run test:run && npm run build && cd ..
```

Expected: 全部 PASS

```bash
git add scripts/fake_openai_server.py tests/test_fake_openai_server.py frontend/e2e/workbench.spec.ts README.md PROJECT-PASSPORT.md
git commit -m "feat: fake server 支持 SSE 流式，E2E 覆盖 thinking 面板与回放，更新文档"
```

---

## 完成定义（批次 1）

- [ ] 真实网关冒烟：`ollama/gpt-oss:120b` 走一次 2x2 depth 1 run，实时页可见流式 thinking、报告与回放含 thinking（记录到 PROJECT-PASSPORT 冒烟小节）。
- [ ] `uv run pytest -m "not slow"` 全绿；前端四件套全绿。
- [ ] 降级路径验证：对任一只支持非流式的 provider 跑一次 run，确认 provider params 里 `stream` 变为 false。
