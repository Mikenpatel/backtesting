"""
routes/ws.py — WebSocket endpoint for real-time price streaming.

What this does:
  Maintains a set of connected browser clients.
  Every second, reads the price cache and broadcasts updated prices
  to all connected clients.

How the frontend connects:
  const ws = new WebSocket("ws://localhost:8081/ws")
  ws.onmessage = (event) => {
    const data = JSON.parse(event.data)
    // data = { type: "quote", symbol: "NIFTY", ltp: 24176, ... }
  }

Message types sent to frontend:
  { type: "snapshot", quotes: { NIFTY: {...}, BANKNIFTY: {...} } }
    → Sent once immediately on connection — full price snapshot

  { type: "quote", symbol: "NIFTY", ltp: 24176, ... }
    → Sent on every tick for symbols with fresh Fyers data

  { type: "ping" }
    → Sent every 30s to keep the connection alive through proxies

Why not send one message per tick?
  Fyers sends thousands of ticks per minute during market hours.
  Sending each tick to every browser would saturate the connection.
  We batch: read the cache every second, send one message per changed symbol.
  1 update/second is more than enough for a dashboard display.

WebSocket connection lifecycle:
  1. Browser opens WebSocket connection to /ws
  2. Server adds client to `connected_clients` set
  3. Server sends a snapshot immediately (all current prices)
  4. Background loop runs every second: read cache → broadcast changes
  5. Browser disconnects → server removes from `connected_clients`
  6. On disconnect: any pending await raises WebSocketDisconnect → we catch it

Thread safety note:
  connected_clients is modified from async code only (FastAPI's event loop).
  The price cache is read here and written by the Fyers WS thread.
  The cache uses a threading.Lock internally — safe for cross-thread access.
"""

import asyncio
import json
from datetime import datetime
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from core.logger import get_logger
import market.cache as cache
import market.simulator as sim

logger = get_logger(__name__)
router = APIRouter()

# Set of all currently connected WebSocket clients
# When a browser opens /ws, its WebSocket object is added here
# When it disconnects (tab closed, navigation, etc.), it is removed
connected_clients: set[WebSocket] = set()

# Track which prices we've already sent to detect changes
# {client_id: {symbol: ltp}}
# (not implemented here for simplicity — we broadcast all prices every second)


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """
    WebSocket endpoint — one persistent connection per browser tab.

    This function runs for the entire lifetime of each client connection.
    When the client disconnects, WebSocketDisconnect is raised and we clean up.
    """
    await ws.accept()
    connected_clients.add(ws)
    client_id = id(ws)
    logger.info(f"WebSocket client connected: {client_id} (total: {len(connected_clients)})")

    try:
        # Send immediate snapshot so the client has data right away
        # (don't wait for the next broadcast cycle)
        snapshot = _build_snapshot()
        await ws.send_text(json.dumps({"type": "snapshot", "quotes": snapshot}))

        # Keep the connection alive
        # We receive messages from the client (ping/pong) and send broadcasts
        # The broadcast loop runs in the background (see start_broadcast_loop below)
        while True:
            try:
                # Wait for client messages (ping keepalive from browser)
                # With a timeout so we can detect dead connections
                data = await asyncio.wait_for(ws.receive_text(), timeout=35.0)
                # Client can send {"type": "ping"} → we respond with pong
                if data:
                    msg = json.loads(data)
                    if msg.get("type") == "ping":
                        await ws.send_text(json.dumps({"type": "pong"}))
            except asyncio.TimeoutError:
                # No message from client in 35s — send a ping to check if alive
                await ws.send_text(json.dumps({"type": "ping"}))

    except WebSocketDisconnect:
        logger.info(f"WebSocket client disconnected: {client_id}")
    except Exception as e:
        logger.warning(f"WebSocket error for client {client_id}: {e}")
    finally:
        connected_clients.discard(ws)
        logger.info(f"WebSocket client removed: {client_id} (remaining: {len(connected_clients)})")


def _build_snapshot() -> dict:
    """
    Build a full price snapshot from the cache.
    If a symbol is not in cache (no live data yet), use the simulator.

    Returns a dict: {"NIFTY": {quote}, "BANKNIFTY": {quote}, ...}
    """
    symbols   = ["NIFTY", "BANKNIFTY", "FINNIFTY", "SENSEX"]
    snapshot  = {}
    for symbol in symbols:
        cached = cache.get(symbol)
        if cached and cache.has_fresh_data(symbol):
            snapshot[symbol] = cached
        else:
            # Simulator for symbols not yet in cache
            snapshot[symbol] = sim.get_quote(symbol)
    return snapshot


async def broadcast_loop():
    """
    Background task that broadcasts price updates to all connected clients.

    Runs forever, waking every second to push new data.
    Started from main.py's startup event.

    Design choice — why not push on every Fyers tick?
      The Fyers WS thread can't directly write to FastAPI's async WebSocket.
      Cross-thread async is complex and error-prone.
      Instead: Fyers thread writes to cache → async loop reads cache → sends to clients.
      1-second polling of an in-memory dict is negligible overhead.
    """
    while True:
        await asyncio.sleep(1)

        if not connected_clients:
            continue   # skip work if nobody is connected

        snapshot = _build_snapshot()
        message  = json.dumps({"type": "snapshot", "quotes": snapshot})

        # Send to all clients — remove disconnected ones
        disconnected = set()
        for client in connected_clients:
            try:
                await client.send_text(message)
            except Exception:
                disconnected.add(client)

        for client in disconnected:
            connected_clients.discard(client)
