"""
market/cache.py — In-memory price cache.

This is the central data bus between:
  - The Fyers WebSocket client (writer, runs in Thread 2)
  - Every HTTP route and WebSocket client (readers, run in Thread 1)

Why in-memory (not Redis, not DB)?
  Price ticks arrive many times per second. Reading/writing to a database
  or Redis on every tick adds 1-10ms latency and creates thousands of
  unnecessary DB operations. A Python dict is nanosecond access.

  Drawback: cache is lost on server restart. That is fine — prices are
  fetched fresh from Fyers on reconnect within seconds.

Thread safety:
  A threading.Lock protects the dict from simultaneous reads and writes.
  Without a lock, Python can corrupt the dict if two threads write at the
  same time (even though Python has the GIL, dict operations are not atomic).

Data freshness:
  Each cache entry has a `timestamp`. The adapter checks if the timestamp
  is recent enough (within STALE_THRESHOLD_SECONDS) before trusting it.
  If stale (market closed, WS disconnected), adapter falls back to simulator.

Usage:
    import market.cache as cache

    # Write (called by websocket.py on every tick)
    cache.update("NIFTY", {"ltp": 24176, "open": 24050, ...})

    # Read (called by adapter.py, routes, WebSocket broadcaster)
    data = cache.get("NIFTY")   # returns dict or None
    data = cache.get_all()      # returns all symbols as dict
    ok   = cache.has_fresh_data("NIFTY")  # True if updated within threshold
"""

import threading
from datetime import datetime, timezone
from typing import Optional

# If a price hasn't been updated in this many seconds, consider it stale
STALE_THRESHOLD_SECONDS = 60

# The actual cache: {"NIFTY": {"ltp": 24176, "timestamp": datetime, ...}}
_cache: dict[str, dict] = {}

# Lock protects _cache from concurrent read/write access
_lock = threading.Lock()


def update(symbol: str, data: dict) -> None:
    """
    Store or update the price for a symbol.
    Called by the Fyers WebSocket client on every tick.

    Args:
        symbol: Internal symbol name e.g. "NIFTY"
        data:   Dict with ltp, open, high, low, change, change_pct, vix
    """
    with _lock:
        _cache[symbol] = {
            **data,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }


def get(symbol: str) -> Optional[dict]:
    """
    Get the latest cached price for a symbol.
    Returns None if symbol has never been received.
    """
    with _lock:
        return _cache.get(symbol)


def get_all() -> dict[str, dict]:
    """
    Get all cached prices. Used by the WebSocket broadcaster
    to push a snapshot to newly connected frontend clients.
    """
    with _lock:
        return dict(_cache)   # return a copy, not a reference


def has_fresh_data(symbol: str) -> bool:
    """
    Returns True if the symbol has a cached price updated recently
    (within STALE_THRESHOLD_SECONDS).

    Used by the adapter to decide: live data or simulator?
    """
    with _lock:
        entry = _cache.get(symbol)
        if not entry:
            return False

        ts_str = entry.get("timestamp")
        if not ts_str:
            return False

        try:
            ts = datetime.fromisoformat(ts_str)
            age = (datetime.now(timezone.utc) - ts).total_seconds()
            return age < STALE_THRESHOLD_SECONDS
        except Exception:
            return False


def mark_stale() -> None:
    """
    Called when the WebSocket disconnects. Clears the cache so
    has_fresh_data() returns False and the adapter uses the simulator.
    """
    with _lock:
        _cache.clear()


# Core Technical Decoupled Components
# 1. In-Memory Caching over Databases
# Stock market ticks generate 50–100 data packets per second during active hours. Writing every individual tick directly to a traditional database (like PostgreSQL) or a loopback caching service (like Redis) adds 1–10ms of network latency and creates massive I/O bottlenecks.

# This system saves data into a native Python dictionary stored directly inside the application's RAM space, providing nanosecond read/write access.

# The cache is transient (clears on restart). Since live market data is refreshed dynamically within seconds of reconnection, permanent database storage is bypassed for state data.

# 2. Thread Safety with threading.Lock
# Even though Python uses a Global Interpreter Lock (GIL) to manage single-microsecond execution, modifying a dictionary is not a single ("atomic") operation at the bytecode level. Python's interpreter automatically switches thread contexts using a 5-millisecond time slice.

# Without structural safety, Thread 2 could be paused halfway through compiling an index update packet. Thread 1 would then read a malformed object, crashing the application.

# A threading.Lock() object forces any thread trying to access or change the cache to acquire a structural key. If the cache is being written to, readers are safely held in line until the transaction completes perfectly.

# 🎛️ Data Flow and The Callback Switchboard
# When subscribing to multiple tickers (e.g., ["NSE:NIFTY50-INDEX", "NSE:BANKNIFTY-INDEX"]), Fyers does not send grouped lists. It transmits a continuous, rapid-fire stream of individual, isolated payload dictionaries.

# The _on_message(message) client method handles this stream using a series of stringent security Guard Clauses:
