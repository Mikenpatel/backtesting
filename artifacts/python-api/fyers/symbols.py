"""
fyers/symbols.py — Symbol mapping between our names and Fyers API names.

Why this file exists:
  We use short names internally: "NIFTY", "BANKNIFTY", "FINNIFTY", "SENSEX"
  Fyers requires fully qualified symbols: "NSE:NIFTY50-INDEX", etc.

  Centralising the mapping here means:
  - Adding a new underlying = add one line here, nothing else changes
  - No magic strings scattered across route files

Lot sizes and strike intervals are also here because they are exchange-defined
constants that belong with the symbol definitions.
"""

# Maps our internal name → Fyers REST/WebSocket symbol
FYERS_SYMBOL_MAP: dict[str, str] = {
    "NIFTY":     "NSE:NIFTY50-INDEX",
    "BANKNIFTY": "NSE:NIFTYBANK-INDEX",
    "FINNIFTY":  "NSE:FINNIFTY-INDEX",
    "SENSEX":    "BSE:SENSEX-INDEX",
}

# Reverse map: Fyers symbol → our internal name
# Used when Fyers WebSocket sends us a tick — we translate back
INTERNAL_SYMBOL_MAP: dict[str, str] = {v: k for k, v in FYERS_SYMBOL_MAP.items()}

# NSE-defined lot sizes (updated Feb 2024)
LOT_SIZES: dict[str, int] = {
    "NIFTY":     75,
    "BANKNIFTY": 15,
    "FINNIFTY":  65,
    "SENSEX":    10,
}

# Strike price intervals — NIFTY strikes go 24000, 24050, 24100, etc.
STRIKE_INTERVALS: dict[str, int] = {
    "NIFTY":     50,
    "BANKNIFTY": 100,
    "FINNIFTY":  50,
    "SENSEX":    100,
}

# Expiry weekday: NIFTY/FINNIFTY expire on Thursday (3), SENSEX on Friday (4)
EXPIRY_WEEKDAY: dict[str, int] = {
    "NIFTY":     3,  # Thursday
    "BANKNIFTY": 3,  # Thursday
    "FINNIFTY":  3,  # Thursday
    "SENSEX":    4,  # Friday
}

# All symbols we subscribe to on the Fyers WebSocket feed
WEBSOCKET_SYMBOLS: list[str] = list(FYERS_SYMBOL_MAP.values())


def to_fyers(symbol: str) -> str:
    """Convert internal symbol to Fyers format. Raises ValueError if unknown."""
    result = FYERS_SYMBOL_MAP.get(symbol)
    if not result:
        raise ValueError(f"Unknown symbol: {symbol!r}. Known: {list(FYERS_SYMBOL_MAP.keys())}")
    return result


def from_fyers(fyers_symbol: str) -> str | None:
    """Convert Fyers symbol to internal name. Returns None if not in our map."""
    return INTERNAL_SYMBOL_MAP.get(fyers_symbol)


def get_lot_size(symbol: str) -> int:
    return LOT_SIZES.get(symbol, 25)


def get_strike_interval(symbol: str) -> int:
    return STRIKE_INTERVALS.get(symbol, 50)
