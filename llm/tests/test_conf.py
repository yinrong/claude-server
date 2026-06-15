"""E2E tests for LM2 (env-var config) and LM3 (provider-aware get_llm)."""
from __future__ import annotations

import importlib
import os
import sys


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _reload_conf():
    """Reload _conf so os.getenv reads the current environment."""
    import llm._conf as conf_mod
    importlib.reload(conf_mod)
    return conf_mod


# ---------------------------------------------------------------------------
# LM2: environment-variable driven configuration
# ---------------------------------------------------------------------------

class TestEnvVarConfig:
    def test_base_url_from_env(self, monkeypatch):
        """LLM_BASE_URL env var must be picked up by _conf.BASE_URL."""
        monkeypatch.setenv("LLM_BASE_URL", "http://custom-openai.example/v1")
        conf = _reload_conf()
        assert conf.BASE_URL == "http://custom-openai.example/v1"

    def test_anthropic_base_url_from_env(self, monkeypatch):
        """LLM_ANTHROPIC_BASE_URL env var must be picked up."""
        monkeypatch.setenv("LLM_ANTHROPIC_BASE_URL", "http://custom-anthropic.example/anthropic")
        conf = _reload_conf()
        assert conf.ANTHROPIC_BASE_URL == "http://custom-anthropic.example/anthropic"

    def test_api_key_from_env(self, monkeypatch):
        """LLM_API_KEY env var must be picked up."""
        monkeypatch.setenv("LLM_API_KEY", "test-api-key-123")
        conf = _reload_conf()
        assert conf.API_KEY == "test-api-key-123"

    def test_default_model_from_env(self, monkeypatch):
        """LLM_DEFAULT_MODEL env var must be picked up."""
        monkeypatch.setenv("LLM_DEFAULT_MODEL", "gpt-4o")
        conf = _reload_conf()
        assert conf.DEFAULT_MODEL == "gpt-4o"

    def test_anthropic_model_from_env(self, monkeypatch):
        """LLM_ANTHROPIC_MODEL env var must be picked up."""
        monkeypatch.setenv("LLM_ANTHROPIC_MODEL", "claude-3-opus-20240229")
        conf = _reload_conf()
        assert conf.ANTHROPIC_MODEL == "claude-3-opus-20240229"

    def test_defaults_when_env_not_set(self, monkeypatch):
        """When no env vars are set, defaults must be used."""
        for key in (
            "LLM_BASE_URL",
            "LLM_ANTHROPIC_BASE_URL",
            "LLM_API_KEY",
            "LLM_DEFAULT_MODEL",
            "LLM_ANTHROPIC_MODEL",
        ):
            monkeypatch.delenv(key, raising=False)

        conf = _reload_conf()
        assert conf.BASE_URL == "http://model.mify.ai.srv/v1"
        assert conf.ANTHROPIC_BASE_URL == "http://model.mify.ai.srv/anthropic"
        assert "sk-" in conf.API_KEY  # default key starts with sk-
        assert conf.DEFAULT_MODEL == "mimo-v2-flash"
        assert conf.ANTHROPIC_MODEL == "ppio/pa/claude-opus-4-6"


# ---------------------------------------------------------------------------
# LM3: provider-aware get_llm factory
# ---------------------------------------------------------------------------

class TestGetLlmProvider:
    def test_get_llm_openai_returns_openai_backend(self):
        """get_llm(provider='openai') must return an LLM backed by OpenAIBackend."""
        from llm._client import get_llm
        from llm._backend_openai import OpenAIBackend

        llm = get_llm(provider="openai")
        assert isinstance(llm._backend, OpenAIBackend)

    def test_get_llm_anthropic_returns_anthropic_backend(self):
        """get_llm(provider='anthropic') must return an LLM backed by AnthropicBackend."""
        from llm._client import get_llm
        from llm._backend_anthropic import AnthropicBackend

        llm = get_llm(provider="anthropic")
        assert isinstance(llm._backend, AnthropicBackend)

    def test_get_llm_default_is_openai(self):
        """get_llm() with no provider must default to OpenAI backend (existing behaviour)."""
        from llm._client import get_llm
        from llm._backend_openai import OpenAIBackend

        llm = get_llm()
        assert isinstance(llm._backend, OpenAIBackend)
