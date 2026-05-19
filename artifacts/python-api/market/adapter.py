"""
market/adapter.py — The single decision point: live Fyers data or simulator?

This is the Adapter pattern in action.

Every route that needs market data calls this module, never the Fyers client
or simulator directly. This module decides which source to use.

Decision logic:
  1. Are Fyers credentials configured? No → simulator
  2. Does the cache have fresh data for this symbol? No → simulator
  3. Cache has fresh data → return it directly (no Fyers API call needed)
  4. For option chain (not in WS cache) → call Fyers REST API
  5. If Fyers REST call fails → simulator fallback

Why this indirection?
  Routes never change when the data source changes.
  If tomorrow Fyers adds a better API, you change this file only.
  The 15 route handlers are untouched.

Mode tracking:
  We track whether recent Fyers calls have succeeded or failed.
  This powers the "LIVE / IP BLOCKED / SIMULATOR" badge in the frontend.
"""

from datetime import datetime
from typing import Optional

import market.cache as cache
import market.simulator as sim
import fyers.client as fyers_client
from core.config import settings
from core.logger import get_logger
from fyers.symbols import get_lot_size, get_strike_interval

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Health tracking — powers the mode badge in the frontend
# ---------------------------------------------------------------------------
# None = no calls made yet (optimistic)
# True = last Fyers call succeeded
# False = last Fyers call failed
_fyers_healthy: Optional[bool] = None
_fyers_fail_reason: str = ""


def _record_success():
    global _fyers_healthy, _fyers_fail_reason
    _fyers_healthy = True
    _fyers_fail_reason = ""


def _record_failure(err: Exception):
    global _fyers_healthy, _fyers_fail_reason
    _fyers_healthy = False
    msg = str(err)
    if "1015" in msg or "rate limit" in msg.lower() or "banned" in msg.lower():
        _fyers_fail_reason = (
            "Fyers is blocking requests from this server's IP (Cloudflare 1015). "
            "Run locally for live data."
        )
    elif "401" in msg or "unauthorized" in msg.lower():
        _fyers_fail_reason = "Access token rejected — may have expired. Update FYERS_ACCESS_TOKEN."
    else:
        _fyers_fail_reason = msg[:120]


# ---------------------------------------------------------------------------
# Mode reporting (used by GET /api/market/mode)
# ---------------------------------------------------------------------------

def get_market_mode() -> dict:
    """
    Returns current data source status.
    Powers the LIVE / IP BLOCKED / SIMULATOR badge in the frontend UI.
    """
    has_credentials = settings.is_live_mode

    if not has_credentials:
        return {
            "mode": "simulator",
            "has_credentials": False,
            "reason": "FYERS_APP_ID or FYERS_ACCESS_TOKEN not set — using Black-Scholes simulator",
        }

    if _fyers_healthy is False:
        return {
            "mode": "blocked",
            "has_credentials": True,
            "reason": _fyers_fail_reason or "Fyers API calls are failing — falling back to simulator",
        }

    return {
        "mode": "live",
        "has_credentials": True,
        "reason": (
            "FYERS_APP_ID and FYERS_ACCESS_TOKEN are set (verifying…)"
            if _fyers_healthy is None
            else "Live data from Fyers WebSocket"
        ),
    }


# ---------------------------------------------------------------------------
# Public API — these are what routes call
# ---------------------------------------------------------------------------

def get_quote(symbol: str) -> dict:
    """
    Get the latest price for an index.

    Priority:
      1. Fresh Fyers WebSocket cache entry (sub-second age)
      2. Fyers REST API (if WS cache is empty — e.g. right after startup)
      3. Black-Scholes simulator (if Fyers is unavailable)
    """
    # Try WebSocket cache first (fastest path)
    if settings.is_live_mode and cache.has_fresh_data(symbol):
        logger.info("Inside live mode")
        data = cache.get(symbol)
        if data:
            _record_success()
            return data

    # Try Fyers REST as fallback for live mode
    if settings.is_live_mode:
        # try:
            result = fyers_client.get_quote(symbol)
            logger.info("I am inside live mode")
            _record_success()
            # Also populate the cache so /ws clients get it
            cache.update(symbol, result)
            return result
        # except Exception as e:
            # _record_failure(e)
            # logger.warning(f"Fyers get_quote failed for {symbol}: {e} — using simulator")

    # Simulator fallback
    return sim.get_quote(symbol)


def get_option_chain(symbol: str, expiry: str) -> dict:
    """
    Get the full option chain (all strikes, greeks, OI).
    Option chains are not in the WS cache, so we always call Fyers REST.
    Falls back to Black-Scholes simulator on any error.
    """
    if settings.is_live_mode:
        try:
            result = fyers_client.get_option_chain(symbol, expiry)
            _record_success()
            return result
        except Exception as e:
            _record_failure(e)
            logger.warning(f"Fyers get_option_chain failed for {symbol}/{expiry}: {e} — using simulator")

    return sim.get_option_chain(symbol, expiry)


def get_expiries(symbol: str) -> list[str]:
    """Get available expiry dates. Falls back to calculated dates from simulator."""
    if settings.is_live_mode:
        try:
            result = fyers_client.get_expiries(symbol)
            if result:
                _record_success()
                return result
        except Exception as e:
            _record_failure(e)
            logger.warning(f"Fyers get_expiries failed for {symbol}: {e} — using simulator")

    return sim.get_expiries(symbol)


def get_current_option_price(symbol: str, strike: float, option_type: str, expiry: str) -> float:
    """
    Get current price for a single option leg.
    Used when marking open trade legs to market for P&L calculation.
    """
    if settings.is_live_mode:
        try:
            chain = get_option_chain(symbol, expiry)
            row   = next((s for s in chain["strikes"] if s["strike"] == strike), None)
            if row:
                return row["call_ltp"] if option_type == "CE" else row["put_ltp"]
        except Exception as e:
            logger.warning(f"Could not get option price for {symbol} {strike}{option_type}: {e}")

    return sim.get_current_option_price(symbol, strike, option_type, expiry)


def get_vix() -> float:
    """
    Get India VIX. Comes from the FYERS WebSocket if subscribed,
    otherwise simulated.
    """
    # VIX from cache (if we subscribe to India VIX symbol)
    vix_data = cache.get("VIX")
    if vix_data and cache.has_fresh_data("VIX"):
        return vix_data.get("ltp", sim.get_vix())

    return sim.get_vix()


def find_iron_condor_legs(
    symbol: str,
    expiry: str,
    wing_width: int,
    lot_multiplier: int = 1,
) -> dict:
    """
    Find and price the 4 legs of an Iron Condor strategy.
    ATM ± wing_width for sell legs, ATM ± wing_width*2 for buy legs.
    """
    chain       = get_option_chain(symbol, expiry)
    lot_size    = get_lot_size(symbol)
    interval    = get_strike_interval(symbol)
    atm         = chain["atm_strike"]

    actual_wing = round(wing_width / interval) * interval

    sell_call_strike = atm + actual_wing
    buy_call_strike  = atm + actual_wing * 2
    sell_put_strike  = atm - actual_wing
    buy_put_strike   = atm - actual_wing * 2

    def _price(strike, opt_type):
        row = next((s for s in chain["strikes"] if s["strike"] == strike), None)
        if row:
            return row["call_ltp"] if opt_type == "CE" else row["put_ltp"]
        return 0.0

    sell_call = _price(sell_call_strike, "CE")
    buy_call  = _price(buy_call_strike,  "CE")
    sell_put  = _price(sell_put_strike,  "PE")
    buy_put   = _price(buy_put_strike,   "PE")

    net_credit = sell_call + sell_put - buy_call - buy_put
    max_profit = net_credit * lot_size * lot_multiplier
    max_loss   = (actual_wing - net_credit) * lot_size * lot_multiplier

    def _leg(strike, opt_type, action, price):
        return {
            "symbol": symbol, "option_type": opt_type, "strike": strike,
            "expiry": expiry, "action": action, "quantity": lot_multiplier,
            "entry_price": price, "current_price": price, "lot_size": lot_size,
        }

    return {
        "legs": [
            _leg(sell_call_strike, "CE", "SELL", sell_call),
            _leg(buy_call_strike,  "CE", "BUY",  buy_call),
            _leg(sell_put_strike,  "PE", "SELL", sell_put),
            _leg(buy_put_strike,   "PE", "BUY",  buy_put),
        ],
        "net_credit": round(net_credit, 2),
        "max_profit": round(max_profit, 2),
        "max_loss":   round(max_loss, 2),
        "atm_strike": atm,
    }


def find_intraday_ic_legs(
    symbol: str,
    expiry: str,
    capital_deployed: float,
    target_return_pct: float,
    brokerage_cost: float,
    max_buying_leg_premium: float,
) -> dict:
    """
    Find Intraday Iron Condor legs targeting a specific return percentage.
    Selects selling strikes closest to the required credit, with cheap buying hedges.
    """
    chain    = get_option_chain(symbol, expiry)
    lot_size = get_lot_size(symbol)
    atm      = chain["atm_strike"]
    strikes  = chain["strikes"]

    target_pnl       = (capital_deployed * target_return_pct) / 100
    net_needed       = target_pnl + brokerage_cost
    net_points_needed = net_needed / lot_size

    buy_calls = [s for s in strikes if s["strike"] > atm and s["call_ltp"] <= max_buying_leg_premium]
    buy_puts  = [s for s in strikes if s["strike"] < atm and s["put_ltp"]  <= max_buying_leg_premium]

    buy_call = buy_calls[0]  if buy_calls else None
    buy_put  = buy_puts[-1]  if buy_puts  else None

    buy_call_prem = (buy_call["call_ltp"] if buy_call else max_buying_leg_premium)
    buy_put_prem  = (buy_put["put_ltp"]   if buy_put  else max_buying_leg_premium)
    total_buy     = buy_call_prem + buy_put_prem
    total_sell_needed = net_points_needed + total_buy

    sell_call_target = total_sell_needed / 2
    sell_put_target  = total_sell_needed / 2

    sell_call_candidates = sorted(
        [s for s in strikes if s["strike"] > atm
         and s["strike"] < (buy_call["strike"] if buy_call else atm + 500)
         and s["call_ltp"] >= sell_call_target * 0.6],
        key=lambda s: abs(s["call_ltp"] - sell_call_target),
    )
    sell_put_candidates = sorted(
        [s for s in strikes if s["strike"] < atm
         and s["strike"] > (buy_put["strike"] if buy_put else atm - 500)
         and s["put_ltp"] >= sell_put_target * 0.6],
        key=lambda s: abs(s["put_ltp"] - sell_put_target),
    )

    sell_call = sell_call_candidates[0] if sell_call_candidates else next((s for s in strikes if s["strike"] == atm + get_strike_interval(symbol)), None)
    sell_put  = sell_put_candidates[0]  if sell_put_candidates  else next((s for s in strikes if s["strike"] == atm - get_strike_interval(symbol)), None)

    sell_call_prem = sell_call["call_ltp"] if sell_call else 0.0
    sell_put_prem  = sell_put["put_ltp"]   if sell_put  else 0.0
    net_credit     = sell_call_prem + sell_put_prem - buy_call_prem - buy_put_prem

    def _leg(strike, opt_type, action, price):
        return {
            "symbol": symbol, "option_type": opt_type, "strike": strike,
            "expiry": expiry, "action": action, "quantity": 1,
            "entry_price": price, "current_price": price, "lot_size": lot_size,
        }

    return {
        "legs": [
            _leg(sell_call["strike"] if sell_call else atm, "CE", "SELL", sell_call_prem),
            _leg(buy_call["strike"]  if buy_call  else atm, "CE", "BUY",  buy_call_prem),
            _leg(sell_put["strike"]  if sell_put  else atm, "PE", "SELL", sell_put_prem),
            _leg(buy_put["strike"]   if buy_put   else atm, "PE", "BUY",  buy_put_prem),
        ],
        "net_credit":         round(net_credit, 2),
        "net_points_needed":  round(net_points_needed, 2),
        "target_pnl":         round(target_pnl, 2),
        "max_buying_leg_premium": max_buying_leg_premium,
        "atm_strike":         atm,
    }
