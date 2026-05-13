"""
main.py — Entry point for the Indian Options Paper Trader Python API.

READ THIS FIRST. This file does four things:
  1. Creates the FastAPI application (with camelCase JSON responses)
  2. Registers all route modules under /api
  3. On startup: verifies DB, seeds strategies, starts Fyers WS thread,
                 starts WebSocket broadcast loop
  4. Starts uvicorn on the configured PORT

FastAPI lifespan (replaces deprecated @app.on_event):
  The @asynccontextmanager lifespan function runs setup code before `yield`
  and teardown code after `yield`. FastAPI calls it automatically.
"""

import asyncio
import threading
import uvicorn
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings
from core.database import init_db
from core.logger import get_logger
from core.response import CamelCaseJSONResponse

# Route modules — each file handles one domain
from routes import market, trades, strategies, dashboard, ws
from routes.ws import broadcast_loop

# Fyers WebSocket client — runs in a background thread
from fyers.websocket import FyersWebSocketClient

# Seed preset strategies into DB on first boot
from services.seed_strategies import seed_strategies_if_empty

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Lifespan — startup + shutdown
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Modern FastAPI lifespan handler.

    Everything BEFORE yield runs at startup.
    Everything AFTER yield runs at shutdown.

    Why lifespan instead of @app.on_event("startup")?
      @app.on_event is deprecated in FastAPI 0.93+. The lifespan approach
      uses Python's standard async context manager protocol — cleaner, type-safe,
      and supported by all modern ASGI frameworks.
    """
    # --- STARTUP ---
    logger.info("Server starting up")

    # Verify database connection is working before accepting requests
    init_db()

    # Insert 6 preset strategies if the strategies table is empty
    await seed_strategies_if_empty()

    # Start Fyers WebSocket in a background thread.
    # Reason for thread (not asyncio task):
    #   The Fyers SDK uses blocking socket I/O internally. If we ran it
    #   in an asyncio task, it would block the event loop and freeze
    #   all HTTP request handling. A daemon thread runs independently.
    if settings.fyers_app_id and settings.fyers_access_token:
        fyers_client = FyersWebSocketClient()
        ws_thread = threading.Thread(target=fyers_client.start, daemon=True)
        ws_thread.start()
        logger.info("Fyers WebSocket client started in background thread")
    else:
        logger.warning(
            "FYERS_APP_ID or FYERS_ACCESS_TOKEN not set in .env — "
            "running in simulator mode (Black-Scholes pricing, no live data)"
        )

    # Start the WebSocket broadcast loop as an asyncio background task.
    # This reads the price cache every second and pushes updates
    # to all connected frontend WebSocket clients via /ws.
    broadcast_task = asyncio.create_task(broadcast_loop())
    logger.info("WebSocket broadcast loop started")

    logger.info(f"API server ready on port {settings.port}")
    logger.info(f"Interactive docs: http://localhost:{settings.port}/docs")

    yield  # ← server runs here, handling all requests

    # --- SHUTDOWN ---
    broadcast_task.cancel()
    logger.info("Server shutting down")


# ---------------------------------------------------------------------------
# Create the FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Indian Options Paper Trader API",
    version="2.0.0",
    description="Python FastAPI backend with live Fyers data and WebSocket streaming.",
    lifespan=lifespan,
    # CamelCaseJSONResponse converts all dict keys from snake_case to camelCase.
    # This ensures the React frontend receives `strategyType` not `strategy_type`.
    default_response_class=CamelCaseJSONResponse,
)

# Allow the React frontend (different port during development) to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Register routes
# ---------------------------------------------------------------------------

# All REST routes under /api to match the Node.js backend path
app.include_router(market.router,     prefix="/api")
app.include_router(trades.router,     prefix="/api")
app.include_router(strategies.router, prefix="/api")
app.include_router(dashboard.router,  prefix="/api")

# WebSocket lives at /ws (no /api prefix — different protocol)
app.include_router(ws.router)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # python main.py
    # For development with auto-reload: uvicorn main:app --reload --port 8000
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=settings.port,
        reload=False,
        log_level="info",
    )
