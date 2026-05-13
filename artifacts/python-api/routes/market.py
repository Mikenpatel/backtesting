"""
routes/market.py — Market data endpoints.

Endpoints:
  GET /api/healthz             Health check — is the server running?
  GET /api/market/mode         Is data live from Fyers or simulated?
  GET /api/market/quote        Single index quote (NIFTY, BANKNIFTY, etc.)
  GET /api/market/expiries     Available expiry dates for an underlying
  GET /api/market/option-chain Full strike chain with greeks and OI

How routes work in FastAPI:
  @router.get("/path")        ← decorator registers this URL+method
  def handler(param: str):    ← function runs when request arrives
      return {...}            ← dict is automatically JSON-serialised

Query parameters:
  def handler(symbol: str = "NIFTY"):  ← ?symbol=NIFTY in URL
  The type annotation validates the input — non-string raises 422

Error handling:
  HTTPException(status_code=400, detail="message")
  FastAPI catches this and returns {"detail": "message"} with status 400.
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from market.adapter import get_quote, get_option_chain, get_expiries, get_market_mode
from models.schemas import QuoteResponse, OptionChainResponse, MarketModeResponse

router = APIRouter()

VALID_SYMBOLS = {"NIFTY", "BANKNIFTY", "FINNIFTY", "SENSEX"}


def _validate_symbol(symbol: str) -> str:
    """Raise 400 if symbol is not one we track."""
    s = symbol.upper()
    if s not in VALID_SYMBOLS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown symbol '{symbol}'. Valid: {sorted(VALID_SYMBOLS)}"
        )
    return s


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@router.get("/healthz")
def health_check():
    """
    Simple liveness probe.
    Returns 200 with {"status": "ok"} when the server is running.
    Used by Replit and monitoring tools to verify the service is up.
    """
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Market mode badge
# ---------------------------------------------------------------------------

@router.get("/market/mode", response_model=MarketModeResponse)
def market_mode():
    """
    Returns the current data source:
      - "live"      → Fyers WebSocket is connected and sending ticks
      - "blocked"   → Fyers credentials set but IP is blocked (Cloudflare 1015)
      - "simulator" → No Fyers credentials, using Black-Scholes simulation

    The React frontend reads this to show the LIVE / IP BLOCKED / SIMULATOR badge.
    """
    return get_market_mode()


# ---------------------------------------------------------------------------
# Market quotes
# ---------------------------------------------------------------------------

@router.get("/market/quote", response_model=QuoteResponse)
def market_quote(symbol: str = Query(default="NIFTY", description="Index symbol")):
    """
    Get a real-time (or simulated) quote for one index.

    Query params:
      ?symbol=NIFTY       (default)
      ?symbol=BANKNIFTY
      ?symbol=FINNIFTY
      ?symbol=SENSEX

    Response includes: ltp, open, high, low, change, change_pct, vix, timestamp
    """
    symbol = _validate_symbol(symbol)
    try:
        return get_quote(symbol)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ---------------------------------------------------------------------------
# Expiry dates
# ---------------------------------------------------------------------------

@router.get("/market/expiries")
def market_expiries(symbol: str = Query(default="NIFTY")):
    """
    Get available expiry dates for an underlying.

    Returns a list of date strings in our format: ["14MAY26", "21MAY26", ...]

    NIFTY/BANKNIFTY/FINNIFTY: Thursdays
    SENSEX: Fridays
    Includes monthly expiries (last Thursday of each month).
    """
    symbol = _validate_symbol(symbol)
    try:
        expiries = get_expiries(symbol)
        return {"symbol": symbol, "expiries": expiries}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


# ---------------------------------------------------------------------------
# Option chain
# ---------------------------------------------------------------------------

@router.get("/market/option-chain", response_model=OptionChainResponse)
def market_option_chain(
    symbol: str = Query(default="NIFTY"),
    expiry: str = Query(default="", description="e.g. 14MAY26"),
):
    """
    Get the full option chain for a symbol and expiry.

    Returns 21 strikes (ATM ± 10 strikes) with for each:
      call: LTP, OI, volume, IV, delta, theta, vega
      put:  LTP, OI, volume, IV, delta, theta, vega

    If expiry is empty, uses the nearest available expiry.
    """
    symbol = _validate_symbol(symbol)

    if not expiry:
        # Default to nearest expiry if not specified
        expiries = get_expiries(symbol)
        if not expiries:
            raise HTTPException(status_code=404, detail=f"No expiries found for {symbol}")
        expiry = expiries[0]

    try:
        chain = get_option_chain(symbol, expiry)
        return chain
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
