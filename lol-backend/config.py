"""Centralised runtime configuration for the backend.

Values are read from environment variables, optionally populated from a
``.env`` file. Real environment variables always take precedence over ``.env``
values. Search order for ``.env`` (first match wins per key):

    1. Next to the frozen executable (PyInstaller build).
    2. The repository root (one level above this backend directory).
    3. This backend directory.

See ``.env.example`` in the repository root for every supported key.
"""
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent

_env_candidates = []
if getattr(sys, "frozen", False):
    _env_candidates.append(Path(sys.executable).resolve().parent / ".env")
_env_candidates += [BACKEND_DIR.parent / ".env", BACKEND_DIR / ".env"]

for _env_file in _env_candidates:
    if _env_file.is_file():
        load_dotenv(_env_file, override=False)


def _get_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


RIOT_API_KEY = os.getenv("RIOT_API_KEY", "").strip()
RIOT_PLATFORM = os.getenv("RIOT_PLATFORM", "euw1").strip()
RIOT_REGION = os.getenv("RIOT_REGION", "europe").strip()

BACKEND_HOST = os.getenv("BACKEND_HOST", "127.0.0.1").strip()
BACKEND_PORT = _get_int("BACKEND_PORT", 8000)

CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").strip().upper()
