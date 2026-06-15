"""Backend protocol for LLM providers."""
from __future__ import annotations

from typing import Any, Protocol


class Backend(Protocol):
    def chat(self, messages: list[dict], tools: list | None, **kw: Any) -> Any: ...
