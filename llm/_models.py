from __future__ import annotations

import json
from pathlib import Path
from urllib.request import Request, urlopen

from llm import _conf


def _fetch_models() -> list | dict:
    request = Request(
        url=f"{_conf.BASE_URL.rstrip('/')}/models",
        method="GET",
        headers={"api-key": _conf.API_KEY, "Accept": "application/json"},
    )
    with urlopen(request, timeout=20) as response:
        return json.loads(response.read().decode("utf-8"))


def _format_models(payload: list | dict) -> list[dict]:
    grouped: dict[str, dict[str, list[str]]] = {}
    for item in payload.get("data", []):
        provider = item["owned_by"]
        model_type = item["model_type"]
        grouped.setdefault(provider, {}).setdefault(model_type, []).append(item["id"])
    return [
        {
            "provider": provider,
            "models": {model_type: sorted(model_ids) for model_type, model_ids in sorted(model_types.items())},
        }
        for provider, model_types in sorted(grouped.items())
    ]


def reload_model_list() -> Path:
    cache_path = Path(_conf.CACHE_DIR) / _conf.MODELS_CACHE_FILE
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    with cache_path.open("w", encoding="utf-8") as file:
        json.dump(_format_models(_fetch_models()), file, ensure_ascii=False, indent=2)
        file.write("\n")
    return cache_path
