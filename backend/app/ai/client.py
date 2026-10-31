"""Thin wrapper around the Anthropic SDK.

* Model defaults to Claude Opus 5.5 (override with KAIROS_AI_MODEL).
* Server-side refusal fallbacks are on (`fallbacks="default"`), so a request a
  safety classifier declines is re-run on Anthropic's recommended fallback model.
* The client is injectable so tests can run the whole agent loop offline.
"""
from __future__ import annotations

import os
from typing import Any

MODEL = os.getenv("KAIROS_AI_MODEL", "claude-opus-5-5")
FALLBACK_BETA = "server-side-fallback-2026-07-01"

_client: Any = None


class AIUnavailable(RuntimeError):
    pass


def _has_credentials() -> bool:
    return bool(os.getenv("ANTHROPIC_API_KEY") or os.getenv("ANTHROPIC_AUTH_TOKEN") or os.getenv("ANTHROPIC_PROFILE"))


def set_client(client: Any) -> None:
    """Inject a client (tests) or reset to None to re-detect credentials."""
    global _client
    _client = client


def get_client():
    global _client
    if _client is None and _has_credentials():
        import anthropic

        _client = anthropic.Anthropic()
    return _client


def enabled() -> bool:
    return get_client() is not None


def create(**kwargs):
    """messages.create with the project's defaults. Raises AIUnavailable without credentials."""
    client = get_client()
    if client is None:
        raise AIUnavailable("AI is not configured - set ANTHROPIC_API_KEY on the server")
    return client.beta.messages.create(
        model=MODEL,
        betas=[FALLBACK_BETA],
        fallbacks="default",
        **kwargs,
    )


def text_of(response) -> str:
    return "".join(b.text for b in response.content if getattr(b, "type", None) == "text").strip()


def check_stop(response) -> None:
    if response.stop_reason == "refusal":
        detail = getattr(getattr(response, "stop_details", None), "explanation", None)
        raise AIUnavailable(f"The model declined this request{': ' + detail if detail else ''}")
