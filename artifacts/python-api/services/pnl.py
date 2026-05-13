"""
services/pnl.py — P&L calculation engine.

Centralises all P&L math so:
  - Routes don't contain math (separation of concerns)
  - Logic can be tested independently
  - Adding a new P&L calculation type = one place to change

P&L concepts for options:

  Unrealized P&L:
    The profit/loss if we closed the position RIGHT NOW at current market prices.
    For open trades only.
    = (current_price - entry_price) * quantity * lot_size
    But sign flips for SELL legs: we collected premium when selling, so a
    price DROP is good for us (we can buy back cheaper).

  Realized P&L:
    The actual profit/loss AFTER closing the trade.
    Stored permanently in the database.

  Formula per leg:
    If BUY leg:  pnl = (current_price - entry_price) * quantity * lot_size
    If SELL leg: pnl = (entry_price - current_price) * quantity * lot_size
                          ↑ reversed — we want price to fall

Usage:
    from services.pnl import compute_unrealized_pnl, format_trade
"""

from typing import Optional
from sqlalchemy.orm import Session

from models.db import Trade, TradeLeg
from market.adapter import get_current_option_price
from core.logger import get_logger

logger = get_logger(__name__)


def resolve_symbol(leg_symbol: str) -> str:
    """
    Extract the underlying index name from an option symbol string.

    Option symbols look like: "NIFTY26MAY24500CE"
    We need just: "NIFTY"

    This is needed because get_current_option_price() takes the underlying
    name (NIFTY), not the full option symbol.
    """
    if "BANKNIFTY" in leg_symbol:
        return "BANKNIFTY"
    if "FINNIFTY" in leg_symbol:
        return "FINNIFTY"
    if "SENSEX" in leg_symbol:
        return "SENSEX"
    return "NIFTY"


def compute_unrealized_pnl(legs: list[TradeLeg]) -> float:
    """
    Calculate total unrealized P&L for a list of option legs.

    For each leg:
      - Fetch current market price (from cache or simulator)
      - Calculate how much the position has moved since entry
      - Sum across all legs

    Returns:
        Total unrealized P&L in rupees (rounded to 2 decimal places)
    """
    total = 0.0
    for leg in legs:
        try:
            underlying = resolve_symbol(leg.symbol)
            current_price = get_current_option_price(
                underlying,
                float(leg.strike),
                leg.option_type,
                leg.expiry,
            )
            # P&L per point = quantity * lot_size
            # For SELL: we profit when price drops (we sold high, buy back low)
            # For BUY:  we profit when price rises (we bought low, sell high)
            leg_pnl = (current_price - float(leg.entry_price)) * leg.quantity * leg.lot_size
            if leg.action == "SELL":
                leg_pnl = -leg_pnl   # flip sign for sell legs

            total += leg_pnl
        except Exception as e:
            logger.warning(f"Could not compute P&L for leg {leg.id}: {e}")
            continue

    return round(total, 2)


def format_leg(leg: TradeLeg, closed: bool = False) -> dict:
    """
    Convert a TradeLeg DB row to the API response shape.
    For closed trades, uses exit_price instead of fetching current price.
    """
    if closed and leg.exit_price is not None:
        current_price = float(leg.exit_price)
    else:
        try:
            underlying = resolve_symbol(leg.symbol)
            current_price = get_current_option_price(
                underlying,
                float(leg.strike),
                leg.option_type,
                leg.expiry,
            )
        except Exception:
            current_price = float(leg.entry_price)

    return {
        "id":           leg.id,
        "trade_id":     leg.trade_id,
        "symbol":       leg.symbol,
        "option_type":  leg.option_type,
        "strike":       float(leg.strike),
        "expiry":       leg.expiry,
        "action":       leg.action,
        "quantity":     leg.quantity,
        "entry_price":  float(leg.entry_price),
        "exit_price":   float(leg.exit_price) if leg.exit_price is not None else None,
        "current_price": current_price,
        "lot_size":     leg.lot_size,
        "created_at":   leg.created_at.isoformat() if leg.created_at else None,
    }


def format_trade(trade: Trade, legs: list[TradeLeg]) -> dict:
    """
    Convert a Trade DB row + its legs to the full API response shape.
    Handles live P&L calculation for open trades.
    """
    is_closed = trade.status == "closed"

    formatted_legs = [format_leg(leg, closed=is_closed) for leg in legs]

    return {
        "id":                      trade.id,
        "strategy_type":           trade.strategy_type,
        "strategy_frequency":      trade.strategy_frequency,
        "underlying":              trade.underlying,
        "status":                  trade.status,
        "entry_time":              trade.entry_time.isoformat() if trade.entry_time else None,
        "exit_time":               trade.exit_time.isoformat() if trade.exit_time else None,
        "entry_underlying_price":  float(trade.entry_underlying_price),
        "exit_underlying_price":   float(trade.exit_underlying_price) if trade.exit_underlying_price else None,
        "unrealized_pnl":          float(trade.unrealized_pnl),
        "realized_pnl":            float(trade.realized_pnl) if trade.realized_pnl is not None else None,
        "net_premium":             float(trade.net_premium) if trade.net_premium is not None else None,
        "capital_deployed":        float(trade.capital_deployed) if trade.capital_deployed is not None else None,
        "return_pct":              float(trade.return_pct) if trade.return_pct is not None else None,
        "max_profit":              float(trade.max_profit) if trade.max_profit is not None else None,
        "max_loss":                float(trade.max_loss) if trade.max_loss is not None else None,
        "notes":                   trade.notes,
        "legs":                    formatted_legs,
        "created_at":              trade.created_at.isoformat() if trade.created_at else None,
        "updated_at":              trade.updated_at.isoformat() if trade.updated_at else None,
    }
