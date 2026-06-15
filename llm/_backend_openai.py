"""OpenAI-compatible backend."""
from __future__ import annotations

from typing import Any

import openai

from llm import _conf


class OpenAIBackend:
    def __init__(self) -> None:
        self._client = openai.OpenAI(
            api_key=_conf.API_KEY,
            base_url=_conf.BASE_URL,
        )

    def chat(self, messages: list[dict], tools: list | None, **kw: Any) -> Any:
        provider = kw.pop("provider", _conf.MODEL_PROVIDER_ID)
        call_kwargs: dict[str, Any] = {
            "model": kw.pop("model", _conf.DEFAULT_MODEL),
            "messages": messages,
            "extra_headers": {"X-Model-Provider-Id": provider},
            **kw,
        }
        if tools:
            call_kwargs["tools"] = tools
        return self._client.chat.completions.create(**call_kwargs)
