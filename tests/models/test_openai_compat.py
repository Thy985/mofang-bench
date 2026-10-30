import json

import httpx
import pytest
import respx

from mofang.models.openai_compat import OpenAICompatibleAdapter
from mofang.models.provider import ModelParams, ProviderError

BASE = "https://example.test/v1"


@pytest.fixture
def adapter() -> OpenAICompatibleAdapter:
    return OpenAICompatibleAdapter(
        base_url=BASE,
        api_key="secret",
        model="test-model",
        retry_delay=0,
    )


@respx.mock
async def test_parses_tool_call(adapter: OpenAICompatibleAdapter) -> None:
    respx.post(f"{BASE}/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "call-1",
                                    "type": "function",
                                    "function": {
                                        "name": "turn",
                                        "arguments": '{"face":"R","amount":1}',
                                    },
                                }
                            ],
                        },
                        "finish_reason": "tool_calls",
                    }
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5},
            },
        )
    )
    turn = await adapter.chat(
        [{"role": "user", "content": "go"}], [], ModelParams()
    )
    assert turn.tool_calls[0].name == "turn"
    assert turn.tool_calls[0].arguments == {"face": "R", "amount": 1}
    assert turn.usage.prompt_tokens == 10


@respx.mock
async def test_malformed_arguments(adapter: OpenAICompatibleAdapter) -> None:
    respx.post(f"{BASE}/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "tool_calls": [
                                {
                                    "id": "c1",
                                    "type": "function",
                                    "function": {
                                        "name": "turn",
                                        "arguments": "{bad",
                                    },
                                }
                            ]
                        }
                    }
                ]
            },
        )
    )
    turn = await adapter.chat(
        [{"role": "user", "content": "go"}], [], ModelParams()
    )
    assert turn.tool_calls[0].arguments is None
    assert turn.tool_calls[0].raw_arguments == "{bad"


@respx.mock
async def test_retries_429(adapter: OpenAICompatibleAdapter) -> None:
    route = respx.post(f"{BASE}/chat/completions")
    route.side_effect = [
        httpx.Response(429, text="rate limited"),
        httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]}),
    ]
    turn = await adapter.chat(
        [{"role": "user", "content": "go"}], [], ModelParams()
    )
    assert turn.content == "ok"
    assert route.call_count == 2


@respx.mock
async def test_tolerates_sse_done_suffix(adapter: OpenAICompatibleAdapter) -> None:
    body = '{"choices": [{"message": {"content": "ok"}}]}data: [DONE]\n\n'
    respx.post(f"{BASE}/chat/completions").mock(
        return_value=httpx.Response(200, text=body)
    )
    turn = await adapter.chat(
        [{"role": "user", "content": "go"}], [], ModelParams()
    )
    assert turn.content == "ok"


async def test_default_client_timeout_allows_slow_models() -> None:
    adapter = OpenAICompatibleAdapter(
        base_url=BASE, api_key="secret", model="test-model"
    )
    try:
        assert adapter._client.timeout.read >= 60
    finally:
        await adapter.close()


@respx.mock
async def test_requests_non_streaming(adapter: OpenAICompatibleAdapter) -> None:
    route = respx.post(f"{BASE}/chat/completions").mock(
        return_value=httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})
    )
    await adapter.chat([{"role": "user", "content": "go"}], [], ModelParams())
    body = json.loads(route.calls[0].request.content)
    assert body["stream"] is False


@respx.mock
async def test_probe_requests_non_streaming(adapter: OpenAICompatibleAdapter) -> None:
    route = respx.post(f"{BASE}/chat/completions").mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": "ok"}}]}
        )
    )
    assert await adapter.probe_tools() is True
    body = json.loads(route.calls[0].request.content)
    assert body["stream"] is False


@respx.mock
async def test_auth_error_does_not_retry(adapter: OpenAICompatibleAdapter) -> None:
    route = respx.post(f"{BASE}/chat/completions").mock(
        return_value=httpx.Response(401, text="bad key")
    )
    with pytest.raises(ProviderError) as exc:
        await adapter.chat(
            [{"role": "user", "content": "go"}], [], ModelParams()
        )
    assert exc.value.kind == "auth"
    assert route.call_count == 1


@respx.mock
async def test_connect_error_raises_retryable_transport_error(
    adapter: OpenAICompatibleAdapter,
) -> None:
    route = respx.post(f"{BASE}/chat/completions").mock(
        side_effect=httpx.ConnectError("refused")
    )
    with pytest.raises(ProviderError) as exc:
        await adapter.chat(
            [{"role": "user", "content": "go"}], [], ModelParams()
        )
    assert exc.value.kind == "transport"
    assert exc.value.retryable is True
    assert route.call_count == 4


@respx.mock
async def test_read_timeout_still_reports_timeout_kind(
    adapter: OpenAICompatibleAdapter,
) -> None:
    route = respx.post(f"{BASE}/chat/completions").mock(
        side_effect=httpx.ReadTimeout("slow")
    )
    with pytest.raises(ProviderError) as exc:
        await adapter.chat(
            [{"role": "user", "content": "go"}], [], ModelParams()
        )
    assert exc.value.kind == "timeout"
    assert exc.value.retryable is True
    assert route.call_count == 4


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

