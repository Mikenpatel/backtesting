"""
core/response.py — Camel-case JSON response for FastAPI.

Why this is needed:
  Python convention:    snake_case  (e.g. strategy_type, change_pct)
  JavaScript convention: camelCase  (e.g. strategyType, changePct)

  The React frontend (and the generated React Query hooks from openapi.yaml)
  expect camelCase field names. Without this, field like `change_pct` would
  arrive as `change_pct` and the frontend would see `undefined`.

How it works:
  We replace FastAPI's default JSONResponse with CamelCaseJSONResponse.
  Every dict key returned by any route handler is recursively converted:
    "strategy_type" → "strategyType"
    "change_pct"    → "changePct"
    "underlying_ltp" → "underlyingLtp"

  Lists and nested dicts are handled recursively.

Usage:
  Set this as the default response class in main.py:
    app = FastAPI(default_response_class=CamelCaseJSONResponse)
  That's it — all routes use it automatically.
"""

import re
import json
from fastapi.responses import JSONResponse


def _to_camel(snake: str) -> str:
    """
    Convert a snake_case string to camelCase.
    Examples:
      "strategy_type"   → "strategyType"
      "change_pct"      → "changePct"
      "ltp"             → "ltp"          (no change, no underscore)
      "underlying_ltp"  → "underlyingLtp"
    """
    parts = snake.split("_")
    return parts[0] + "".join(p.capitalize() for p in parts[1:])


def _convert_keys(obj):
    """
    Recursively convert all dict keys from snake_case to camelCase.
    Leaves list items, strings, numbers, and None untouched.
    """
    if isinstance(obj, dict):
        return {_to_camel(k): _convert_keys(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_convert_keys(item) for item in obj]
    return obj


class CamelCaseJSONResponse(JSONResponse):
    """
    A JSONResponse subclass that converts all dict keys to camelCase
    before serialising to JSON.

    Set as the default response class:
        app = FastAPI(default_response_class=CamelCaseJSONResponse)
    """

    def render(self, content) -> bytes:
        converted = _convert_keys(content)
        return json.dumps(
            converted,
            ensure_ascii=False,
            allow_nan=False,
            indent=None,
            separators=(",", ":"),
        ).encode("utf-8")
