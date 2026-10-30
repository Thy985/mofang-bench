# 全流式 reasoning 评测链路 — 设计文档

- 日期：2026-10-30
- 状态：已评审（方向方案 A，用户已批准）
- 范围：批次 1 详细设计；批次 2/3 只定方向

## 背景与定位

mofang 是自用 LLM 评测工作台，典型场景为少量题、深诊断（失败归因）。
对标评审（Cube Bench / τ-bench / open-webui）指出当前最大缺口：请求固定
`stream: false`（`src/mofang/models/openai_compat.py:68`），thinking/
reasoning 全库无处理，模型失败时最便宜的错误归因数据被整段丢弃。

目标：打通"模型 thinking 全流式 → SSE 实时展示 → 落库 → 回放可查"全栈纵切。

已拍板的决策：

| 分岔 | 决策 |
|---|---|
| reasoning 深度 | 全流式实时展示（非仅落库） |
| 不支持流式的网关 | auto 自动降级非流式，并记住该 provider 的降级 |
| max_usd（批次 3 预决策） | 删除字段与 `episodes.cost_usd` 引用，将来需要再加 |

## 批次 1：adapter 层

文件：`src/mofang/models/openai_compat.py`

1. `chat()` 增加流式路径：`"stream": true` +
   `"stream_options": {"include_usage": true}`，用 `httpx.AsyncClient.stream()`
   手动解析 SSE 分帧（不引入 openai SDK，保持零依赖）。
2. delta 解析三种来源，统一并入 `ModelTurn.reasoning: str | None`（新字段）：
   - `delta.reasoning_content`（DeepSeek / vLLM 风格）
   - `delta.reasoning`（第二命名）
   - content 内 `<think>...</think>` 包裹段：出口处剥离进 reasoning
     （兼容保险，约 15 行）。
3. tool_calls 按 `index` 分片重组：`function.arguments` 为碎片段拼接，
   流结束时整体 `json.loads`，失败沿用现有 `arguments=None` 语义。
4. usage：取流末尾带 `usage` 的最终 chunk；`include_usage` 不被网关支持时
   退化为 0 计数（现状非流式同样可能缺 usage，不新增处理）。
5. 非流式路径保留：`message.reasoning_content` / `message.reasoning` 捞取
   并入 `ModelTurn.reasoning`；`decode_json` 与 `_parse` 其余不动。
6. auto 降级：流式请求返回 4xx 且报错文本含 `stream` 关键字时，自动改用
   非流式重发本次请求，并向外暴露降级标记；service 层据此把
   `stream: false` 记入该 provider 的 `params_json`
   （`src/mofang/store/providers.py`），后续 run 不再尝试流式。
   非 stream 相关 4xx 仍按现有 `bad_request` 处理。
7. 重试语义：连接阶段与 HTTP 状态错误沿用现有 4 次指数退避
   （`openai_compat.py:77-109`）；**流中断（首字节后 transport 错误）不重试**，
   抛 `ProviderError("transport", retryable=False)` 终止 episode——避免整 turn
   重放导致 usage 双计。
8. `probe_tools` 保持非流式。

## 批次 1：runner 层

文件：`src/mofang/runner/episode.py`、`src/mofang/models/provider.py`

1. `ProviderAdapter` Protocol 增加可选方法
   `chat_stream(messages, tools, params, on_delta) -> ModelTurn`，
   `on_delta(phase: Literal["thinking", "content"], text: str) -> None`。
   `chat()` 语义不变；`FakeProvider` 不实现 `chat_stream`
   （runner 以 `hasattr` 或 adapter 能力位判断，测试不破）。
2. `_chat`（`episode.py:102-131`）：流式开启时透传回调；cancel/timeout
   的 `asyncio.wait` 竞争逻辑保持，超时/取消路径先关闭流再抛错。
3. 节流在 runner 侧：on_delta 回调累积文本，每 ~64 字符或 ~150ms
   冲刷一次发 `thinking.delta` 事件。理由：`RunEventBus` 的 history
   全量驻留内存（`src/mofang/api/events.py:75`），token 级事件会撑爆它。
4. turn 结束时 thinking 全文随 `model.message` 事件发出，并写入该 turn 的
   `model_message` StepRecord：`result={"content": ..., "thinking": ...}`。

## 批次 1：事件协议（新增 1 种事件 + 1 处载荷扩展）

发布点：`src/mofang/service/runs.py` 的 emit 桥接处。

- 新事件 `thinking.delta`：`{episode_id, seq, text}`，text 为增量片段，
  前端按到达顺序拼接。Last-Event-ID 断点续传天然兼容（重放只重复追加，
  reducer 以 turn 为界重置缓冲，重复事件被同 id 去重拦截）。
- `model.message` 载荷扩展：增加 `thinking` 字段（全文，与落库同源）。
- 前端 `EVENT_TYPES`（`frontend/src/hooks/useRunEvents.ts:10`）注册
  `thinking.delta`；`frontend/src/api/types.ts` 同步类型。

## 批次 1：存储层（零迁移）

- thinking 存入现有 `steps.result_json`，无需改表、无需迁移
  （`src/mofang/store/runs.py:188` `add_steps` 与 `db.py` SCHEMA 不动）。
- 回放页从 `GET /api/episodes/{id}/steps` 读取，API 无需新端点；
  step 序列化处透出 `thinking` 字段。

## 批次 1：前端

文件：`frontend/src/hooks/liveReducer.ts`、实时页与回放页组件。

1. liveReducer 增加 `thinking` 缓冲：`thinking.delta` 追加到当前 turn 的
   缓冲；`model.message` 到达时用事件内全文覆盖缓冲并归档为步骤条目
   （以权威全文为准，防丢帧）；`model.turn.started` 重置缓冲。
2. 实时页：model message 上方渲染折叠面板——流式期间"思考中…"展开态
   实时追加文本，结束后收起为可展开的 thinking 块（对标 open-webui
   折叠交互）。
3. 回放页：`model_message` 步骤展开可见 thinking 全文（monospace、折叠）。
4. three.js / FaceLegend / 路由结构均不动。

## 批次 1：测试

1. respx 模拟 SSE 分帧响应，覆盖：`reasoning_content` 与 `reasoning`
   两种命名、`<think>` 剥离、tool_calls 分片重组、`[DONE]`、
   usage 汇总、流中断不重试、auto 降级路径。
2. fake provider 增加带 reasoning 的 turn；`scripts/fake_openai_server.py`
   发 thinking delta，E2E 链路验证前端面板出现并归档。
3. liveReducer delta 聚合 / 覆盖 / 重置单测。

## 批次 2（方向，另行设计）

- 多 trial / pass@k：`runs.params.trials`、`episodes.trial` 列迁移
  （沿用 `db.py:124` initialize 的 ALTER 先例）、pass@k 无偏估计进
  `src/mofang/eval/aggregate.py`。
- 协议错误语义修正：tool_calls 溢出（`episode.py:310-311`）从
  `protocol_errors` 分离为独立 `overflow_calls`，不再计入
  `MAX_PROTOCOL_ERRORS` 熔断。

## 批次 3（方向，另行设计）

- 删除 `Budget.max_usd`（`src/mofang/runner/budget.py:6-14`）与
  `episodes.cost_usd` 的引用（`src/mofang/store/runs.py:228`）。
- 系统提示词参数化（`src/mofang/runner/context.py`，随 benchmark 冻结）。
- 失败题跨 episode 对照页（复用现有 `/api/compare` 后端的最小子集）。

## 非目标

- 吞吐优化（全局锁、每步 twophase 距离）——少量题场景不受益，不做。
- i18n / a11y 专项。
- 外部基准口径对齐（Cube Bench 五技能维度）。
- 价格估算。

## 风险

- 网关流式行为差异大（passport 已记录多种怪癖）：auto 降级只识别
  "4xx + 报错含 stream"一种信号，其余怪癖仍靠 `params.extra` 手工兜。
- 部分网关 `stream_options` 不支持：按第 4 条退化为 0 usage 计数，
  可能出现 usage 全 0 的 run——报告页需容忍（现状已容忍空 usage）。
