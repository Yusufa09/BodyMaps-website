from __future__ import annotations

import json
import os
import re
from typing import Any

import requests


OLLAMA_BASE_URL = os.getenv(
    "OLLAMA_BASE_URL",
    "http://localhost:11434",
).rstrip("/")

DEFAULT_OLLAMA_MODEL = os.getenv(
    "BODYMAPS_OLLAMA_MODEL",
    "llama3.1",
).strip()

OLLAMA_LIST_TIMEOUT = float(
    os.getenv("OLLAMA_LIST_TIMEOUT_SECONDS", "5")
)

# Local models can take longer than 30 seconds on the first request.
OLLAMA_CHAT_TIMEOUT = float(
    os.getenv("OLLAMA_CHAT_TIMEOUT_SECONDS", "120")
)


class OllamaUnavailable(RuntimeError):
    """Raised when the local Ollama server cannot complete a request."""


class OllamaInvalidResponse(RuntimeError):
    """Raised when Ollama returns a response that cannot be parsed."""


def list_ollama_models(
    timeout: float | None = None,
) -> list[dict[str, Any]]:
    """Return installed Ollama models from /api/tags."""

    try:
        response = requests.get(
            f"{OLLAMA_BASE_URL}/api/tags",
            timeout=(
                timeout
                if timeout is not None
                else OLLAMA_LIST_TIMEOUT
            ),
        )
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError) as exc:
        raise OllamaUnavailable(str(exc)) from exc

    models = payload.get("models", [])

    if not isinstance(models, list):
        return []

    result: list[dict[str, Any]] = []

    for model in models:
        if not isinstance(model, dict):
            continue

        name = str(model.get("name") or "").strip()
        if not name:
            continue

        result.append(
            {
                "name": name,
                "size": model.get("size"),
                "modified_at": model.get("modified_at"),
                "details": model.get("details"),
            }
        )

    return result


def _extract_json_object(text: str) -> dict[str, Any]:
    value = (text or "").strip()

    if not value:
        raise OllamaInvalidResponse(
            "Ollama returned an empty response."
        )

    fenced = re.search(
        r"```(?:json)?\s*(\{.*\})\s*```",
        value,
        flags=re.DOTALL | re.IGNORECASE,
    )

    if fenced:
        value = fenced.group(1).strip()
    elif not value.startswith("{"):
        start = value.find("{")
        end = value.rfind("}")

        if start >= 0 and end > start:
            value = value[start : end + 1]

    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise OllamaInvalidResponse(
            f"Ollama did not return valid JSON: {exc}"
        ) from exc

    if not isinstance(parsed, dict):
        raise OllamaInvalidResponse(
            "Ollama response JSON was not an object."
        )

    return parsed


def _post_chat(
    payload: dict[str, Any],
    timeout: float,
) -> dict[str, Any]:
    try:
        response = requests.post(
            f"{OLLAMA_BASE_URL}/api/chat",
            json=payload,
            timeout=timeout,
        )
        response.raise_for_status()
        data = response.json()
    except requests.Timeout as exc:
        raise OllamaUnavailable(
            "Ollama timed out while generating a response."
        ) from exc
    except (requests.RequestException, ValueError) as exc:
        raise OllamaUnavailable(str(exc)) from exc

    if not isinstance(data, dict):
        raise OllamaInvalidResponse(
            "Ollama returned an unexpected response."
        )

    return data


def chat_json(
    *,
    model: str | None,
    system_prompt: str,
    user_prompt: str,
    timeout: float | None = None,
    temperature: float = 0.2,
) -> dict[str, Any]:
    """
    Call Ollama /api/chat and return one parsed JSON object.

    The response contains conversational text and optional viewer actions.
    """

    selected_model = (
        str(model or DEFAULT_OLLAMA_MODEL).strip()
    )

    if not selected_model:
        raise ValueError("An Ollama model name is required.")

    request_timeout = (
        timeout
        if timeout is not None
        else OLLAMA_CHAT_TIMEOUT
    )

    payload: dict[str, Any] = {
        "model": selected_model,
        "stream": False,
        "keep_alive": "10m",
        "messages": [
            {
                "role": "system",
                "content": system_prompt,
            },
            {
                "role": "user",
                "content": user_prompt,
            },
        ],
        "options": {
            "temperature": temperature,
            "num_ctx": 16384,
            "seed": 42,
        },
        "format": "json",
    }

    data = _post_chat(payload, request_timeout)

    content = (
        ((data.get("message") or {}).get("content") or "")
        .strip()
    )

    try:
        return _extract_json_object(content)
    except OllamaInvalidResponse:
        # Give the model one opportunity to repair malformed JSON.
        repair_payload: dict[str, Any] = {
            "model": selected_model,
            "stream": False,
            "keep_alive": "10m",
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Convert the supplied content into one valid JSON "
                        "object with keys reply, actions, and intent. "
                        "Return JSON only."
                    ),
                },
                {
                    "role": "user",
                    "content": content,
                },
            ],
            "options": {
                "temperature": 0.0,
                "num_ctx": 4096,
                "seed": 42,
            },
            "format": "json",
        }

        repaired = _post_chat(
            repair_payload,
            request_timeout,
        )

        repaired_content = (
            (
                (repaired.get("message") or {})
                .get("content")
                or ""
            )
            .strip()
        )

        return _extract_json_object(repaired_content)
