from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from llm import _conf


def _now() -> str:
    tz_name = os.environ.get("TZ", "Asia/Shanghai")
    try:
        dt = datetime.now(ZoneInfo(tz_name))
    except (ZoneInfoNotFoundError, KeyError):
        dt = datetime.now().astimezone()
    return dt.strftime("%H:%M:%S")


def _truncate(text: str, n: int) -> str:
    text = str(text)
    return text[:n] + f"\n  ... (truncated, total {len(text)} chars)" if len(text) > n else text


class LLMLogger:
    def __init__(self, log_dir: str | Path) -> None:
        self._log_path = Path(log_dir) / "agent.log"
        self._log_path.parent.mkdir(parents=True, exist_ok=True)
        self._fh = open(self._log_path, "a", encoding="utf-8", buffering=1)

    def close(self) -> None:
        self._fh.close()

    def _write(self, line: str) -> None:
        self._fh.write(line + "\n")
        self._fh.flush()

    def log_tool_result(self, tool_name: str, result: str) -> None:
        self._write(f"[{_now()}] ─── TOOL RESULT: {tool_name} ───")
        self._write(f"  {_truncate(result, _conf.LOG_TRUNCATE_TOOL_RESULT)}")

    def on_llm_call(self, messages: list, response: object) -> None:
        self._write(f"[{_now()}] ─── LLM CALL ── messages: {len(messages)} turns")

        tool_calls = None
        content = None
        try:
            tool_calls = response.choices[0].message.tool_calls  # type: ignore[union-attr]
        except (AttributeError, IndexError):
            pass
        try:
            content = response.choices[0].message.content  # type: ignore[union-attr]
        except (AttributeError, IndexError):
            pass

        if tool_calls:
            for tc in tool_calls:
                self._write(f"  → tool: {tc.function.name}  args: {_truncate(tc.function.arguments, _conf.LOG_TRUNCATE_TOOL_ARGS)}")
        elif content:
            self._write(f"  response: {_truncate(content, _conf.LOG_TRUNCATE_LLM_RESPONSE)}")
        else:
            self._write("  [empty response]")
