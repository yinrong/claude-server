from __future__ import annotations

from pathlib import Path
from typing import Any

from llm import _conf
from llm._logger import LLMLogger

_llm_callbacks: list = []


def _create_backend(api_type: str) -> Any:
    if api_type == "anthropic":
        from llm._backend_anthropic import AnthropicBackend
        return AnthropicBackend()
    from llm._backend_openai import OpenAIBackend
    return OpenAIBackend()


class LLM:
    def __init__(self, log_dir: str | Path | None = None, api_type: str = "openai") -> None:
        self._backend = _create_backend(api_type)
        self._logger: LLMLogger | None = None
        if log_dir is not None:
            self._logger = LLMLogger(log_dir)
            _llm_callbacks.append(self._logger.on_llm_call)

    def call(self, messages: Any = None, tools: list | None = None, **kwargs: Any) -> Any:
        if isinstance(messages, str):
            messages = [{"role": "user", "content": messages}]

        response = self._backend.chat(messages or [], tools, **kwargs)

        if _llm_callbacks:
            for cb in list(_llm_callbacks):
                try:
                    cb(messages or [], response)
                except Exception:
                    pass

        return response

    @property
    def logger(self) -> LLMLogger | None:
        return self._logger

    def close(self) -> None:
        if self._logger is not None:
            try:
                _llm_callbacks.remove(self._logger.on_llm_call)
            except ValueError:
                pass
            self._logger.close()
            self._logger = None


def get_llm(
    log_dir: str | Path | None = None,
    api_type: str = "openai",
    provider: str | None = None,
) -> LLM:
    """Return an LLM instance.

    Parameters
    ----------
    provider:
        Shorthand for selecting the backend.  Accepted values:
        - ``'openai'``    → OpenAI-compatible backend (LLM_BASE_URL)
        - ``'anthropic'`` → Anthropic backend (LLM_ANTHROPIC_BASE_URL)
        When specified it takes precedence over *api_type*.
    api_type:
        Legacy parameter kept for backwards-compatibility.  Used when
        *provider* is not given.
    """
    resolved_api_type = provider if provider is not None else api_type
    return LLM(log_dir=log_dir, api_type=resolved_api_type)
