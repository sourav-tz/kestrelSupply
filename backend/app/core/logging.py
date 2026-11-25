import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict

from app.core.config import get_settings

_SECRET_PATTERN = re.compile(
    r"(bearer\s+[a-zA-Z0-9._-]+|password\s*[:=]\s*\S+|api[_-]?key\s*[:=]\s*\S+)",
    re.IGNORECASE,
)


def redact_sensitive(text: str) -> str:
    return _SECRET_PATTERN.sub("[REDACTED]", text)


class StructuredJsonFormatter(logging.Formatter):
    """Formats logs as single-line JSON while scrubbing sensitive fields."""

    RESERVED_ATTRS = {
        "name",
        "msg",
        "args",
        "levelname",
        "levelno",
        "pathname",
        "filename",
        "module",
        "exc_info",
        "exc_text",
        "stack_info",
        "lineno",
        "funcName",
        "created",
        "msecs",
        "relativeCreated",
        "thread",
        "threadName",
        "processName",
        "process",
        "message",
        "asctime",
    }

    def format(self, record: logging.LogRecord) -> str:
        payload: Dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": redact_sensitive(record.getMessage()),
        }
        for key, value in record.__dict__.items():
            if key not in self.RESERVED_ATTRS and not key.startswith("_"):
                if any(s in key.lower() for s in ("password", "secret", "token", "api_key", "authorization")):
                    payload[key] = "[REDACTED]"
                else:
                    payload[key] = redact_sensitive(str(value)) if isinstance(value, str) else value
        if record.exc_info:
            payload["exception"] = redact_sensitive(self.formatException(record.exc_info))
        return json.dumps(payload, default=str)


def configure_logging() -> None:
    settings = get_settings()
    root = logging.getLogger()
    root.setLevel(getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO))
    handler = logging.StreamHandler()
    handler.setFormatter(StructuredJsonFormatter())
    root.handlers = [handler]


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
