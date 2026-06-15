"""Anthropic backend — adapts response to OpenAI-compatible shape."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from llm import _conf


@dataclass
class _FunctionCall:
    name: str
    arguments: str


@dataclass
class _ToolCall:
    id: str
    type: str = "function"
    function: _FunctionCall = field(default_factory=lambda: _FunctionCall("", ""))


@dataclass
class _Message:
    role: str
    content: str | None
    tool_calls: list[_ToolCall] = field(default_factory=list)


@dataclass
class _Choice:
    message: _Message
    finish_reason: str = "stop"


@dataclass
class _Usage:
    prompt_tokens: int
    completion_tokens: int


@dataclass
class _Response:
    choices: list[_Choice]
    usage: _Usage


def _convert_tools(tools: list[dict]) -> list[dict]:
    """Convert OpenAI tool format to Anthropic format."""
    result = []
    for t in tools:
        fn = t.get("function", {})
        result.append({
            "name": fn.get("name", ""),
            "description": fn.get("description", ""),
            "input_schema": fn.get("parameters", {"type": "object", "properties": {}}),
        })
    return result


def _adapt(msg: Any) -> _Response:
    """Adapt anthropic.types.Message to OpenAI-like _Response."""
    tool_calls: list[_ToolCall] = []
    text_parts: list[str] = []

    for block in msg.content:
        if block.type == "text":
            text_parts.append(block.text)
        elif block.type == "tool_use":
            tool_calls.append(_ToolCall(
                id=block.id,
                function=_FunctionCall(
                    name=block.name,
                    arguments=json.dumps(block.input, ensure_ascii=False),
                ),
            ))

    content = "\n".join(text_parts) if text_parts else None
    message = _Message(role="assistant", content=content, tool_calls=tool_calls)
    finish_reason = "tool_calls" if tool_calls else "stop"
    usage = _Usage(
        prompt_tokens=msg.usage.input_tokens,
        completion_tokens=msg.usage.output_tokens,
    )
    return _Response(choices=[_Choice(message=message, finish_reason=finish_reason)], usage=usage)


class AnthropicBackend:
    def __init__(self) -> None:
        import anthropic  # lazy import — only when API_TYPE == "anthropic"
        self._client = anthropic.Anthropic(
            api_key=_conf.API_KEY,
            base_url=_conf.ANTHROPIC_BASE_URL,
        )

    def chat(self, messages: list[dict], tools: list | None, **kw: Any) -> _Response:
        import anthropic  # noqa: F811
        system_msgs = [m["content"] for m in messages if m["role"] == "system"]
        user_msgs = [m for m in messages if m["role"] != "system"]
        system_text = "\n".join(system_msgs) if system_msgs else anthropic.NOT_GIVEN

        create_kwargs: dict[str, Any] = {
            "model": _conf.ANTHROPIC_MODEL,
            "max_tokens": kw.pop("max_tokens", 8192),
            "messages": user_msgs,
            "system": system_text,
        }
        if tools:
            create_kwargs["tools"] = _convert_tools(tools)

        response = self._client.messages.create(**create_kwargs)
        return _adapt(response)
