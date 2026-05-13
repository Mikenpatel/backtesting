"""
core/logger.py — Structured logging setup.

What is structured logging?
  Instead of: logger.info("User 42 opened trade on NIFTY")
  We do:      logger.info("Trade opened", extra={"user_id": 42, "symbol": "NIFTY"})

  The second form produces JSON like:
  {"level": "INFO", "message": "Trade opened", "user_id": 42, "symbol": "NIFTY"}

  This makes logs searchable and filterable in any log aggregation tool.

Usage:
    from core.logger import get_logger
    logger = get_logger(__name__)

    logger.info("Server started")
    logger.warning("Fyers connection dropped, falling back to simulator")
    logger.error(f"DB error: {e}")
"""

import logging
import sys


def get_logger(name: str) -> logging.Logger:
    """
    Returns a configured logger for the given module name.

    Pass __name__ from the calling module:
        logger = get_logger(__name__)

    This names the logger after the module (e.g., "routes.trades"),
    making it easy to filter logs by module in production.
    """
    logger = logging.getLogger(name)

    # Only add handler if not already configured (prevents duplicate logs)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(logging.Formatter(
            fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            datefmt="%H:%M:%S",
        ))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
        logger.propagate = False  # don't pass to root logger

    return logger
