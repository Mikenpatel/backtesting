"""
market/simulator.py — Black-Scholes market data simulator.

When to use this:
  - Fyers credentials not configured
  - Fyers WebSocket disconnected or IP blocked
  - Market is closed (prices are stale)

What it produces:
  - Realistic-looking prices that move slightly each day
  - Full option chains with correct greeks (delta, theta, vega)
  - Expiry dates matching the real NSE calendar

How prices are generated:
  We use "seed-based random" — the random number is derived from today's date
  and the symbol name. This means:
  - Same day = same price every time you ask (no jarring jumps on refresh)
  - Different day = different price (realistic daily movement)
  - The movement is ±1% for NIFTY, ±1.5% for BANKNIFTY

The Black-Scholes formula:
  Industry standard for pricing European options. Takes:
    S = current underlying price (spot)
    K = strike price
    T = time to expiry in years
    r = risk-free rate (India's repo rate ~6.5%)
    σ = implied volatility (we use VIX/100)
  Produces the theoretical fair value of the option.
"""

import math
from datetime import datetime, date, timedelta
from typing import Optional

from fyers.symbols import LOT_SIZES, STRIKE_INTERVALS, EXPIRY_WEEKDAY

# Base prices — approximate current market levels
BASE_PRICES: dict[str, float] = {
    "NIFTY":     24350.0,
    "BANKNIFTY": 52800.0,
    "FINNIFTY":  23900.0,
    "SENSEX":    80200.0,
}

BASE_VIX = 14.5
RISK_FREE_RATE = 0.065   # India repo rate


# ---------------------------------------------------------------------------
# Price simulation
# ---------------------------------------------------------------------------

def _seeded_random(seed: float) -> float:
    """Deterministic pseudo-random number in [0, 1) from a seed."""
    x = math.sin(seed + 1) * 10000
    return x - math.floor(x)


def _get_daily_movement(symbol: str) -> float:
    """
    Returns a consistent daily price movement factor for a symbol.
    Same symbol + same day = same movement every call.
    """
    today = date.today()
    day_seed = today.year * 10000 + today.month * 100 + today.day
    sym_seed = sum(ord(c) for c in symbol)
    movement = (_seeded_random(day_seed + sym_seed) - 0.5) * 2
    max_move = 0.015 if symbol == "BANKNIFTY" else 0.01
    return movement * max_move


def _get_elapsed_minutes() -> float:
    """Minutes since 09:15 IST today (market open). 0 if before market open."""
    now = datetime.now()
    market_open = now.replace(hour=9, minute=15, second=0, microsecond=0)
    return max(0.0, (now - market_open).total_seconds() / 60)


def get_ltp(symbol: str) -> float:
    """
    Get a simulated last traded price for an index.
    Uses daily seed + 5-minute intraday noise.
    """
    base       = BASE_PRICES.get(symbol, 24000.0)
    daily_move = _get_daily_movement(symbol)
    intra_min  = _get_elapsed_minutes()
    noise_seed = math.floor(intra_min / 5)
    noise      = (_seeded_random(noise_seed * 17 + ord(symbol[0])) - 0.5) * 0.004
    interval   = STRIKE_INTERVALS.get(symbol, 50)
    raw        = base * (1 + daily_move + noise)
    return round(raw / interval) * interval


def get_vix() -> float:
    """Simulated VIX with day-to-day variation."""
    today = date.today()
    seed  = today.year * 10000 + today.month * 100 + today.day
    change = (_seeded_random(seed * 7) - 0.5) * 2
    return round(BASE_VIX + change, 2)


def get_quote(symbol: str) -> dict:
    """Full market quote for one index."""
    ltp        = get_ltp(symbol)
    base       = BASE_PRICES.get(symbol, 24000.0)
    daily_move = _get_daily_movement(symbol)
    open_price = round(base * (1 + daily_move * 0.1))
    high       = round(ltp * 1.003)
    low        = round(ltp * 0.996)
    change     = round(ltp - open_price, 2)
    change_pct = round((change / open_price) * 100, 2) if open_price else 0.0
    vix        = get_vix()

    return {
        "symbol":     symbol,
        "ltp":        ltp,
        "open":       open_price,
        "high":       high,
        "low":        low,
        "change":     change,
        "change_pct": change_pct,
        "vix":        vix,
        "timestamp":  datetime.utcnow().isoformat(),
    }


# ---------------------------------------------------------------------------
# Expiry calculation
# ---------------------------------------------------------------------------

def get_expiries(symbol: str) -> list[str]:
    """
    Returns upcoming expiry dates in our format (e.g. "14MAY26").
    NIFTY/BANKNIFTY/FINNIFTY expire on Thursdays; SENSEX on Fridays.
    Last Thursday of the month = monthly expiry.
    """
    target_day = EXPIRY_WEEKDAY.get(symbol, 3)  # 3=Thursday, 4=Friday
    today      = date.today()
    expiries: list[str] = []

    # Weekly/biweekly expiries — next 4 Thursdays/Fridays
    for i in range(14):
        d = today + timedelta(days=i)
        if d.weekday() == target_day and d not in expiries:
            expiries.append(_format_expiry(d))
            if len(expiries) >= 4:
                break

    # Monthly expiries — last Thursday of each of next 3 months
    if symbol != "SENSEX":
        for m in range(3):
            month_offset = (today.month - 1 + m) % 12
            year_offset  = (today.month - 1 + m) // 12
            yr  = today.year + year_offset
            mon = month_offset + 1
            monthly = _last_weekday_of_month(yr, mon, 3)  # 3 = Thursday
            fmt = _format_expiry(monthly)
            if fmt not in expiries:
                expiries.append(fmt)

    return expiries[:6]


def _format_expiry(d: date) -> str:
    months = ["JAN","FEB","MAR","APR","MAY","JUN",
               "JUL","AUG","SEP","OCT","NOV","DEC"]
    return f"{d.day:02d}{months[d.month - 1]}{str(d.year)[2:]}"


def _last_weekday_of_month(year: int, month: int, weekday: int) -> date:
    """Returns the last occurrence of weekday (0=Mon...6=Sun) in a month."""
    last_day = date(year, month, 1).replace(
        day=28
    ) + timedelta(days=4)
    last_day = last_day.replace(day=1) - timedelta(days=1)
    days_back = (last_day.weekday() - weekday) % 7
    return last_day - timedelta(days=days_back)


def _parse_expiry(expiry: str) -> datetime:
    months = {"JAN":1,"FEB":2,"MAR":3,"APR":4,"MAY":5,"JUN":6,
               "JUL":7,"AUG":8,"SEP":9,"OCT":10,"NOV":11,"DEC":12}
    day  = int(expiry[:2])
    mon  = months.get(expiry[2:5].upper(), 1)
    year = 2000 + int(expiry[5:7])
    return datetime(year, mon, day, 15, 30, 0)


# ---------------------------------------------------------------------------
# Black-Scholes pricing
# ---------------------------------------------------------------------------

def _norm_cdf(x: float) -> float:
    """Cumulative standard normal distribution (Abramowitz & Stegun approximation)."""
    a = [0.254829592, -0.284496736, 1.421413741, -1.453152027, 1.061405429]
    p = 0.3275911
    sign = 1 if x >= 0 else -1
    x = abs(x) / math.sqrt(2)
    t = 1.0 / (1.0 + p * x)
    y = 1.0 - (((((a[4]*t + a[3])*t + a[2])*t + a[1])*t + a[0])*t) * math.exp(-x*x)
    return 0.5 * (1.0 + sign * y)


def _black_scholes(S: float, K: float, T: float, r: float, sigma: float, is_call: bool) -> float:
    """
    Black-Scholes option price.
    S=spot, K=strike, T=time(years), r=rate, sigma=volatility, is_call=CE or PE
    """
    if T <= 0:
        return max(0.0, S - K if is_call else K - S)
    d1 = (math.log(S / K) + (r + sigma**2 / 2) * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    if is_call:
        return S * _norm_cdf(d1) - K * math.exp(-r * T) * _norm_cdf(d2)
    return K * math.exp(-r * T) * _norm_cdf(-d2) - S * _norm_cdf(-d1)


def _delta(S, K, T, r, sigma, is_call) -> float:
    if T <= 0:
        return (1.0 if S > K else 0.0) if is_call else (-1.0 if S < K else 0.0)
    d1 = (math.log(S / K) + (r + sigma**2 / 2) * T) / (sigma * math.sqrt(T))
    return _norm_cdf(d1) if is_call else _norm_cdf(d1) - 1


def _theta(S, K, T, r, sigma, is_call) -> float:
    if T <= 0:
        return 0.0
    d1  = (math.log(S / K) + (r + sigma**2 / 2) * T) / (sigma * math.sqrt(T))
    d2  = d1 - sigma * math.sqrt(T)
    phi = math.exp(-d1**2 / 2) / math.sqrt(2 * math.pi)
    if is_call:
        th = (-S * phi * sigma / (2 * math.sqrt(T)) - r * K * math.exp(-r * T) * _norm_cdf(d2)) / 365
    else:
        th = (-S * phi * sigma / (2 * math.sqrt(T)) + r * K * math.exp(-r * T) * _norm_cdf(-d2)) / 365
    return round(th, 2)


def _vega(S, K, T, r, sigma) -> float:
    if T <= 0:
        return 0.0
    d1  = (math.log(S / K) + (r + sigma**2 / 2) * T) / (sigma * math.sqrt(T))
    phi = math.exp(-d1**2 / 2) / math.sqrt(2 * math.pi)
    return round(S * phi * math.sqrt(T) / 100, 2)


def get_option_chain(symbol: str, expiry: str) -> dict:
    """Full simulated option chain with Black-Scholes pricing."""
    S        = get_ltp(symbol)
    interval = STRIKE_INTERVALS.get(symbol, 50)
    atm      = round(S / interval) * interval
    today    = datetime.now()
    exp_dt   = _parse_expiry(expiry)
    T        = max(0.001, (exp_dt - today).total_seconds() / (365 * 24 * 3600))
    r        = RISK_FREE_RATE
    base_iv  = get_vix() / 100
    today_n  = date.today()

    strikes = []
    for i in range(-10, 11):
        K         = atm + i * interval
        moneyness = abs(i) / 10
        skew      = moneyness * 0.02
        iv        = base_iv + (skew if i < 0 else 0)

        call_ltp  = max(0.05, _black_scholes(S, K, T, r, iv, True))
        put_ltp   = max(0.05, _black_scholes(S, K, T, r, iv, False))

        oi_base  = 1_000_000 * math.exp(-abs(i) * 0.3)
        seed     = K * 17 + today_n.day
        oi_noise = _seeded_random(seed)

        strikes.append({
            "strike":       K,
            "call_ltp":     round(call_ltp, 2),
            "call_oi":      round(oi_base * (0.8 + oi_noise * 0.4) / 25) * 25,
            "call_volume":  round(oi_base * 0.1 * oi_noise),
            "call_iv":      round(iv * 10000) / 100,
            "call_delta":   round(_delta(S, K, T, r, iv, True), 3),
            "call_theta":   _theta(S, K, T, r, iv, True),
            "call_vega":    _vega(S, K, T, r, iv),
            "put_ltp":      round(put_ltp, 2),
            "put_oi":       round(oi_base * (0.8 + _seeded_random(seed + 1) * 0.4) / 25) * 25,
            "put_volume":   round(oi_base * 0.08 * _seeded_random(seed + 2)),
            "put_iv":       round((iv + 0.01) * 10000) / 100,
            "put_delta":    round(_delta(S, K, T, r, iv, False), 3),
            "put_theta":    _theta(S, K, T, r, iv, False),
            "put_vega":     _vega(S, K, T, r, iv),
        })

    return {
        "symbol":         symbol,
        "expiry":         expiry,
        "underlying_ltp": S,
        "atm_strike":     atm,
        "strikes":        strikes,
    }


def get_current_option_price(symbol: str, strike: float, option_type: str, expiry: str) -> float:
    """Get simulated price for a single option."""
    chain = get_option_chain(symbol, expiry)
    row   = next((s for s in chain["strikes"] if s["strike"] == strike), None)
    if row:
        return row["call_ltp"] if option_type == "CE" else row["put_ltp"]
    # Fallback: compute directly
    S  = get_ltp(symbol)
    dt = _parse_expiry(expiry)
    T  = max(0.001, (dt - datetime.now()).total_seconds() / (365 * 24 * 3600))
    return max(0.05, _black_scholes(S, strike, T, RISK_FREE_RATE, get_vix() / 100, option_type == "CE"))
