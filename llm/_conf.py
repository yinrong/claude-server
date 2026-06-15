from __future__ import annotations

import os

API_KEY = os.getenv('LLM_API_KEY', 'sk-UFop8bGkZVJZUz1FVS9E5w20r1591Kj1d8i6i6AlI7VXkeic')
BASE_URL = os.getenv('LLM_BASE_URL', 'http://model.mify.ai.srv/v1')
MODEL_PROVIDER_ID = 'xiaomi'

CACHE_DIR = '.cache'
MODELS_CACHE_FILE = 'llm_models.json'
DEFAULT_MODEL = os.getenv('LLM_DEFAULT_MODEL', 'mimo-v2-flash')

LOG_TRUNCATE_TOOL_ARGS = 200
LOG_TRUNCATE_LLM_RESPONSE = 400
LOG_TRUNCATE_TOOL_RESULT = 800

ANTHROPIC_BASE_URL = os.getenv('LLM_ANTHROPIC_BASE_URL', 'http://model.mify.ai.srv/anthropic')
ANTHROPIC_MODEL = os.getenv('LLM_ANTHROPIC_MODEL', 'ppio/pa/claude-opus-4-6')
