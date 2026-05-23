"""
fyers/client.py — Fyers REST API client using the official SDK.

Why this is so much simpler than the original Node.js client:
  The original fyers-client.ts was 266 lines of manual HTTP code:
  URL building, auth headers, response parsing, error handling.

  The official Python SDK (fyers_apiv3) handles all of that.
  This file is a thin wrapper that:
  1. Initialises the SDK with our credentials
  2. Calls SDK methods
  3. Translates responses into our internal data shapes

Usage:
    from fyers.client import get_fyers_client
    client = get_fyers_client()
    quote = client.get_quote("NIFTY")

Note: Fyers REST API is used for:
  - Option chain data (full strike list, greeks, OI)
  - Available expiry dates
  - Historical data (future feature)

Real-time quotes come from the WebSocket (fyers/websocket.py), not REST.
"""

from datetime import datetime, date
from typing import Optional
from fyers_apiv3 import fyersModel

from core.config import settings
from core.logger import get_logger
from fyers.symbols import to_fyers, from_fyers, get_strike_interval, EXPIRY_WEEKDAY
import re

logger = get_logger(__name__)


def get_fyers_client() -> fyersModel.FyersModel:
    """
    Creates and returns a Fyers SDK client instance.

    The SDK handles:
    - Authorization header: "{app_id}:{access_token}"
    - JSON serialisation
    - Basic error responses

    We create a new instance per call rather than a singleton because
    the access token can be rotated without restarting the server.
    """
    
    return fyersModel.FyersModel(
        token=settings.fyers_access_token,
        client_id=settings.fyers_app_id,
        is_async=False,   # use synchronous (blocking) mode
        log_path="",      # disable SDK's own logging (we use ours)
    )


def get_quote(symbol: str) -> dict:
    """
    Fetch a real-time snapshot for one index using Fyers REST.

    In the live system, real-time prices come from the WebSocket cache,
    not this function. This is used as a fallback when the WS cache
    doesn't have fresh data yet (e.g. immediately after startup).

    Args:
        symbol: Internal symbol name e.g. "NIFTY"

    Returns:
        dict with keys: symbol, ltp, open, high, low, change, change_pct,
                        vix (0 — Fyers quotes don't include VIX), timestamp
    """
    fyers_symbol = to_fyers(symbol)
    client = get_fyers_client()

    response = client.quotes({"symbols": fyers_symbol})

    # Fyers response shape:
    # {"s": "ok", "d": [{"n": "NSE:NIFTY50-INDEX", "s": "ok", "v": {...}}]}
    if response.get("s") != "ok":
        raise RuntimeError(f"Fyers quotes API error: {response}")

    data = response.get("d", [])
    if not data:
        raise RuntimeError(f"No quote data returned for {symbol}")

    v = data[0]["v"]   # "v" = values dict
    return {
        "symbol":     symbol,
        "ltp":        v["lp"],    # last price
        "open":       v["o"],
        "high":       v["h"],
        "low":        v["l"],
        "change":     round(v["ch"], 2),
        "change_pct": round(v["chp"], 2),
        "vix":        0.0,        # not available in quotes endpoint
        "timestamp":  datetime.utcnow().isoformat(),
    }


def get_expiries(symbol: str) -> list[str]:
    """
    Fetch available expiry dates for an underlying from Fyers option chain.

    We call the option chain with a tiny strike count just to get the
    expiry list — we don't need the full chain data here.

    Returns:
        List of expiry strings in our format e.g. ["14MAY26", "21MAY26", ...]
    """
    fyers_symbol = to_fyers(symbol)
    client = get_fyers_client()

    response = client.optionchain({
        "symbol": fyers_symbol,
        "strikecount": 1,   # minimal — we only want expiries
    })

    if response.get("s") != "ok":
        raise RuntimeError(f"Fyers optionchain API error: {response}")

    expiry_data = response.get("d", {}).get("expiryData", [])
    expiries = []
    for item in expiry_data:
        # Fyers provides expiry as unix timestamp
        ts = item.get("expiry") or item.get("date")
        if ts:
            dt = datetime.fromtimestamp(int(ts))
            expiries.append(_format_expiry(dt))

    return expiries[:6]   # return at most 6 upcoming expiries


def get_option_chain(symbol: str, expiry: str | None) -> dict:
    """
    Fetch the full option chain for a given underlying and expiry.

    Args:
        symbol: e.g. "NIFTY"
        expiry: in our format e.g. "14MAY26"

    Returns:
        dict with keys: symbol, expiry, underlying_ltp, atm_strike, strikes
        where strikes is a list of dicts with call/put LTP, OI, IV, delta, etc.
    """
    fyers_symbol = to_fyers(symbol)
    client = get_fyers_client()

    params: dict = {
        "symbol": fyers_symbol,
        "strikecount": 20,
    }

    # If specific expiry requested, convert to unix timestamp
    if expiry:
        expiry_dt = _parse_expiry(expiry)
        # params["timestamp"] = str(int(expiry_dt.timestamp()))

    response = client.optionchain(params)

    if response.get("s") != "ok":
        raise RuntimeError(f"Fyers optionchain error: {response}")

    d = response.get("data", {})
    expiry_data_list = d.get("expiryData", [])
    underlying_ltp = d.get("optionsChain", [])[0].get("ltp", 0)

    if not expiry_data_list:
        raise RuntimeError(f"No option chain data for {symbol}")

    expiry_data = expiry_data_list[0]
    interval = get_strike_interval(symbol)
    atm_strike = round(underlying_ltp / interval) * interval

        # Parse the option chain data into our internal format
    symbol = d.get("optionsChain", [])[0].get("symbol", "")
    
    option_chain = d.get("optionsChain", [])[1:]

    # option_type = option_chain[0].get("symbol")[-2:]
    # print(option_type)
    strike_map = {}
    for leg in option_chain: 
        print(leg)
        option_type = leg.get("symbol", "")[-2:]
        strike = leg.get('strike_price')
        if strike not in strike_map: 
            strike_map[strike] = {
                "strike": leg.get('strike_price'),
                "call_ltp": 0.0, "call_oi": 0, "call_volume": 0,
                "put_ltp":  0.0, "put_oi":  0, "put_volume":  0,
            }
        
        prefix = "call" if option_type == "CE" else "put"
        strike_map[strike][f"{prefix}_ltp"] = round(leg.get("ltp", 0.0), 2)
        strike_map[strike][f"{prefix}_oi"] = round(leg.get("oi", 0.0), 2)
        strike_map[strike][f"{prefix}_volume"] = round(leg.get("volume", 0.0), 2)
        # break

    strikes = sorted(strike_map.values(), key=lambda x: x["strike"])
    ex_symbol = d.get("optionsChain", [])[0].get("ex_symbol", "")
    return {
        "symbol": ex_symbol,
        "expiry": "5MAY26",
        "underlying_ltp": underlying_ltp,
        "atm_strike": atm_strike,
        "strikes": strikes,
    }

    # # Parse the options chain into our internal format
    # # Fyers returns a list of option legs, each with symbol name and values
    # strike_map: dict[int, dict] = {}
    # for leg in expiry_data.get("optionsChain", []):
    #     name = leg.get("n", "")
    #     v = leg.get("v", {})

    #     parsed = _parse_strike_from_symbol(name)
    #     if not parsed:
    #         continue

    #     strike, option_type = parsed
    #     if strike not in strike_map:
    #         strike_map[strike] = {
    #             "strike": strike,
    #             "call_ltp": 0.0, "call_oi": 0, "call_volume": 0,
    #             "call_iv": 0.0, "call_delta": 0.0, "call_theta": 0.0, "call_vega": 0.0,
    #             "put_ltp":  0.0, "put_oi":  0, "put_volume":  0,
    #             "put_iv":  0.0, "put_delta":  0.0, "put_theta":  0.0, "put_vega":  0.0,
    #         }

    #     prefix = "call" if option_type == "CE" else "put"
    #     strike_map[strike][f"{prefix}_ltp"]    = round(v.get("ltp", 0), 2)
    #     strike_map[strike][f"{prefix}_oi"]     = int(v.get("oi", 0))
    #     strike_map[strike][f"{prefix}_volume"] = int(v.get("volume", 0))
    #     strike_map[strike][f"{prefix}_iv"]     = round(v.get("iv", 0) * 100, 2)
    #     strike_map[strike][f"{prefix}_delta"]  = round(v.get("delta", 0), 3)
    #     strike_map[strike][f"{prefix}_theta"]  = round(v.get("theta", 0), 2)
    #     strike_map[strike][f"{prefix}_vega"]   = round(v.get("vega", 0), 2)

    # strikes = sorted(strike_map.values(), key=lambda x: x["strike"])
    # return {
    #     "symbol":          symbol,
    #     "expiry":          expiry,
    #     "underlying_ltp":  underlying_ltp,
    #     "atm_strike":      atm_strike,
    #     "strikes":         strikes,
    # }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _format_expiry(dt: datetime) -> str:
    """Convert a datetime to our expiry format: 14MAY26"""
    months = ["JAN","FEB","MAR","APR","MAY","JUN",
               "JUL","AUG","SEP","OCT","NOV","DEC"]
    return f"{dt.day:02d}{months[dt.month - 1]}{str(dt.year)[2:]}"


def _parse_expiry(expiry: str) -> datetime:
    """Convert our expiry format (14MAY26) back to a datetime."""
    months = {"JAN":1,"FEB":2,"MAR":3,"APR":4,"MAY":5,"JUN":6,
               "JUL":7,"AUG":8,"SEP":9,"OCT":10,"NOV":11,"DEC":12}
    day  = int(expiry[:2])
    mon  = months[expiry[2:5].upper()]
    year = 2000 + int(expiry[5:7])
    return datetime(year, mon, day, 15, 30, 0)


def _parse_strike_from_symbol(symbol_name: str) -> Optional[tuple[int, str]]:
    """
    Parse strike price and option type from a Fyers symbol name.
    e.g. "NSE:NIFTY24MAY26500CE" → (26500, "CE")
    """
    import re
    match = re.search(r"(\d+)(CE|PE)$", symbol_name)
    if not match:
        return None
    return int(match.group(1)), match.group(2)
