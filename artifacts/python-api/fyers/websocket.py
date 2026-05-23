"""
fyers/websocket.py — Fyers WebSocket client for real-time price streaming.

What this does:
  Maintains a persistent WebSocket connection to Fyers servers.
  Every time a price tick arrives (every trade on NSE), it updates
  the shared price cache (market/cache.py).

Why a background thread?
  The Fyers WebSocket SDK uses blocking I/O internally. FastAPI is async.
  We run the SDK in a separate thread so it doesn't block the async event loop.
  The two communicate through the shared price cache — no direct coupling.

Architecture:
  Thread 1 (main): FastAPI handles HTTP/WebSocket requests
  Thread 2 (this): FyersWebSocketClient receives ticks, updates cache

How to read the callback flow:
  1. FyersDataSocket connects to Fyers servers
  2. We subscribe to NIFTY, BANKNIFTY, FINNIFTY, SENSEX symbols
  3. Fyers pushes a message for every price change
  4. on_message() receives it → updates cache → frontend gets it via /ws
"""

import time
from fyers_apiv3.FyersWebsocket import data_ws

from core.config import settings
from core.logger import get_logger
import market.cache as cache
from fyers.symbols import from_fyers, WEBSOCKET_SYMBOLS

logger = get_logger(__name__)


class FyersWebSocketClient:
    """
    Manages the Fyers WebSocket connection and translates incoming ticks
    into our internal price cache format.

    This is one of the rare places we use a class — because we need to
    maintain state (is_connected, reconnect count) across the callbacks
    that Fyers SDK calls.
    """

    # Special exception used to break the reconnect loop on auth failure.
    class AuthError(Exception):
        pass

    def __init__(self):
        self.is_connected = False
        self.reconnect_count = 0
        self._auth_failed = False   # set True when Fyers returns token-expired
        self._socket = None         # reference kept so we can close it on error

    def start(self):
        """
        Starts the WebSocket connection. Blocks indefinitely (runs in a thread).

        Reconnect strategy (exponential-ish backoff, capped at 30 s):
          attempt 1 → 5 s, attempt 2 → 10 s, ..., attempt 6+ → 30 s

        Auth errors are FATAL — token is invalid until the user refreshes it.
        We stop reconnecting and log a clear message instead of burning CPU
        in a tight loop.
        """
        # while True:
        if self._auth_failed:
            logger.error(
                "Fyers token expired. Update FYERS_ACCESS_TOKEN in .env "
                "and restart the server."
            )
            return   # stop thread — no point retrying with a bad token

        try:
            logger.info("Connecting to Fyers WebSocket...")
            self._connect()
        except FyersWebSocketClient.AuthError:
            self._auth_failed = True
            # loop immediately → hits the guard above and exits
        except Exception as e:
            self.reconnect_count += 1
            wait = min(30, 5 * self.reconnect_count)
            logger.warning(
                f"Fyers WebSocket disconnected: {e}. "
                f"Reconnecting in {wait}s (attempt {self.reconnect_count})"
            )
            cache.mark_stale()
            time.sleep(wait)

    def _connect(self):
        """
        Creates the Fyers DataSocket, subscribes to symbols, and blocks
        until the connection drops.

        reconnect=False — we own the reconnect loop in start() so we can
        implement proper backoff and auth-error detection.  If we let the
        SDK reconnect, it just hammers the server on auth failure.
        """
        self._socket = data_ws.FyersDataSocket(
            access_token=settings.fyers_auth_token,
            log_path="",            # disable SDK file logging
            litemode=False,         # full data (includes OI, volume, Greeks)
            on_message=self._on_message,
            on_error=self._on_error,
            on_close=self._on_close,
            on_connect=self._on_connect,
            reconnect=False,        # we handle reconnects ourselves
        )
        
        # Fyers internal connect method
        self._socket.connect()

        # Subscribe to the 4 Indian index symbols we track
        self._socket.subscribe(
            symbols=WEBSOCKET_SYMBOLS,
            data_type="SymbolUpdate",
        )

        self.is_connected = True
        self.reconnect_count = 0
        logger.info(f"Subscribed to: {WEBSOCKET_SYMBOLS}")

        # Blocks this thread until the connection drops or an error occurs.
        # When it returns, start() loops and reconnects (unless auth failed).
        self._socket.keep_running()

    def _on_connect(self, *args):
        """
        Called by the Fyers SDK when the WebSocket handshake completes.

        The SDK may call this with 0 or 1 arguments depending on version,
        so we accept *args to be forward-compatible.
        """
        logger.info("Fyers WebSocket handshake complete")

    def _on_error(self, message):
        """
        Called on WebSocket errors.

        Auth error (code -99 = 'Token is expired') is fatal.
        We set the flag and close the socket so keep_running() returns.
        The start() loop then sees _auth_failed=True and exits cleanly.

        Note: We do NOT raise here. The callback runs inside Fyers SDK code
        which may swallow exceptions. Instead, we close the socket explicitly
        so keep_running() unblocks, and handle the auth error in start().
        """
        if isinstance(message, dict) and message.get("code") == -99:
            logger.error(
                "Fyers WebSocket: token expired (code -99). "
                "Set a fresh FYERS_ACCESS_TOKEN in .env and restart."
            )
            self._auth_failed = True
            if self._socket:
                try:
                    self._socket.close_connection()
                except Exception:
                    pass
            return
        logger.warning(f"Fyers WebSocket error: {message}")

    def _on_close(self, *args):
        """
        Called when the WebSocket connection closes gracefully.
        *args accepted for SDK version compatibility (0 or 1 args).
        """
        logger.info("Fyers WebSocket connection closed")

    def _on_message(self, message: dict):
        """
        Called by the Fyers SDK for every incoming tick.

        Message shape from Fyers (LiteMode=False):
        {
            "type": "sf",
            "symbol": "NSE:NIFTY50-INDEX",
            "ltp": 24176.0,
            "open_price": 24050.0,
            "high_price": 24220.0,
            "low_price": 23980.0,
            "prev_close_price": 24050.0,
            "volume": 12345678,
            ...
        }
        """
        # Skip non-price messages (connection confirmations, etc.)
        if not isinstance(message, dict):
            return

        fyers_symbol = message.get("symbol") or message.get("s")
        if not fyers_symbol:
            return

        # Translate Fyers symbol back to our internal name
        internal_symbol = from_fyers(fyers_symbol)
        if not internal_symbol:
            return   # symbol we don't track

        ltp = float(message.get("ltp", 0))
        if ltp <= 0:
            return   # invalid tick

        prev_close = float(message.get("prev_close_price", ltp))
        change     = round(ltp - prev_close, 2)
        change_pct = round((change / prev_close) * 100, 2) if prev_close else 0.0

        # Update the shared price cache
        # This is the ONLY place cache is written from the WS thread
        cache.update(internal_symbol, {
            "symbol":     internal_symbol,
            "ltp":        ltp,
            "open":       float(message.get("open_price", ltp)),
            "high":       float(message.get("high_price", ltp)),
            "low":        float(message.get("low_price", ltp)),
            "change":     change,
            "change_pct": change_pct,
            "vix":        0.0,   # VIX comes from a separate subscription
            "timestamp":  None,  # cache.update() sets this automatically
        })
