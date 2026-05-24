"""
routes/trades.py — Trade CRUD and lifecycle endpoints.

Endpoints:
  GET    /api/trades              List all trades (optionally filtered by status)
  POST   /api/trades              Create a new trade with legs
  GET    /api/trades/{id}         Get a single trade with current prices
  PATCH  /api/trades/{id}         Update trade fields (notes, capital, etc.)
  DELETE /api/trades/{id}         Delete a trade and its legs
  POST   /api/trades/{id}/close   Close an open trade, record realized P&L
  POST   /api/trades/refresh-pnl  Refresh unrealized P&L for all open trades

Key design points:
  - format_trade() from services/pnl.py adds live current_price to each leg
  - Close operation fetches current prices, stores realized P&L, logs activity
  - All DB operations happen in the request's session (from Depends(get_db))
  - Errors from market data are logged but don't fail the request
"""

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from core.database import get_db
from models.db import Trade, TradeLeg, ActivityEvent, DailyPnl
from models.schemas import TradeCreate, TradeUpdate, TradeResponse, RefreshPnlResponse
from services.pnl import compute_unrealized_pnl, format_trade, format_leg, resolve_symbol
from market.adapter import get_quote, get_current_option_price
from core.logger import get_logger

logger = get_logger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# GET /api/trades
# ---------------------------------------------------------------------------

@router.get("/trades")
def list_trades(
    status: Optional[str] = Query(default=None, description="Filter: open | closed"),
    db: Session = Depends(get_db),
):
    """
    List all trades, optionally filtered by status.

    ?status=open    → only open trades
    ?status=closed  → only closed trades
    (no filter)     → all trades

    Each trade includes its legs with current market prices.
    """
    query = db.query(Trade)
    if status == "open":
        query = query.filter(Trade.status == "open")
    elif status == "closed":
        query = query.filter(Trade.status == "closed")

    trades = query.order_by(Trade.created_at.desc()).all()

    # Fetch all legs in one query to avoid N+1 queries
    # (N+1 = querying legs inside the loop = one DB call per trade)
    if not trades:
        return []

    trade_ids = [t.id for t in trades]
    all_legs  = db.query(TradeLeg).filter(TradeLeg.trade_id.in_(trade_ids)).all()

    # Group legs by trade_id for fast lookup
    legs_map: dict[int, list[TradeLeg]] = {}
    for leg in all_legs:
        legs_map.setdefault(leg.trade_id, []).append(leg)

    return [format_trade(t, legs_map.get(t.id, [])) for t in trades]


# ---------------------------------------------------------------------------
# POST /api/trades
# ---------------------------------------------------------------------------

@router.post("/trades", status_code=201)
def create_trade(body: TradeCreate, db: Session = Depends(get_db)):
    """
    Create a new paper trade with one or more option legs.

    The entry_underlying_price is fetched live at the moment of creation.
    Each leg is stored with its entry_price from the request body.
    An activity event is logged automatically.
    """
    # Get live underlying price at entry
    try:
        quote = get_quote(body.underlying)
        entry_underlying_price = quote["ltp"]
    except Exception as e:
        logger.warning(f"Could not fetch quote for {body.underlying}: {e}")
        entry_underlying_price = 0.0

    # Create the trade row
    trade = Trade(
        strategy_type=body.strategy_type,
        strategy_frequency=body.strategy_frequency,
        underlying=body.underlying,
        status="open",
        entry_underlying_price=entry_underlying_price,
        unrealized_pnl=0,
        net_premium=body.net_premium,
        capital_deployed=body.capital_deployed,
        max_profit=body.max_profit,
        max_loss=body.max_loss,
        notes=body.notes,
        strategy_id=body.strategy_id,
    )
    db.add(trade)
    db.flush()   # flush to get trade.id without committing yet

    # Create leg rows
    legs = []
    for leg_data in body.legs:
        leg = TradeLeg(
            trade_id=trade.id,
            symbol=leg_data.symbol,
            option_type=leg_data.option_type,
            strike=leg_data.strike,
            expiry=leg_data.expiry,
            action=leg_data.action,
            quantity=leg_data.quantity,
            entry_price=leg_data.entry_price,
            current_price=leg_data.entry_price,   # current = entry at creation
            lot_size=leg_data.lot_size,
        )
        db.add(leg)
        legs.append(leg)

    # Log the activity event
    db.add(ActivityEvent(
        type="trade_opened",
        trade_id=trade.id,
        message=f"{body.strategy_type} trade opened on {body.underlying}",
        timestamp=datetime.utcnow(),
    ))

    db.commit()
    db.refresh(trade)
    for leg in legs:
        db.refresh(leg)

    logger.info(f"Trade created: id={trade.id} {body.strategy_type} on {body.underlying}")
    return format_trade(trade, legs)


# ---------------------------------------------------------------------------
# GET /api/trades/{id}
# ---------------------------------------------------------------------------

@router.get("/trades/{trade_id}")
def get_trade(trade_id: int, db: Session = Depends(get_db)):
    """
    Get a single trade with all legs and current market prices.
    Returns 404 if the trade doesn't exist.
    """
    trade = db.query(Trade).filter(Trade.id == trade_id).first()
    if not trade:
        raise HTTPException(status_code=404, detail=f"Trade {trade_id} not found")

    legs = db.query(TradeLeg).filter(TradeLeg.trade_id == trade_id).all()
    return format_trade(trade, legs)


# ---------------------------------------------------------------------------
# PATCH /api/trades/{id}
# ---------------------------------------------------------------------------

@router.patch("/trades/{trade_id}")
def update_trade(trade_id: int, body: TradeUpdate, db: Session = Depends(get_db)):
    """
    Update editable fields on a trade (notes, capital, max_profit, etc.).
    The strategy_type, underlying, and legs cannot be changed after creation.
    """
    trade = db.query(Trade).filter(Trade.id == trade_id).first()
    if not trade:
        raise HTTPException(status_code=404, detail=f"Trade {trade_id} not found")

    update_data = body.model_dump(exclude_none=True)
    for field, value in update_data.items():
        setattr(trade, field, value)

    db.commit()
    db.refresh(trade)

    legs = db.query(TradeLeg).filter(TradeLeg.trade_id == trade_id).all()
    return format_trade(trade, legs)


# ---------------------------------------------------------------------------
# DELETE /api/trades/{id}
# ---------------------------------------------------------------------------

@router.delete("/trades/{trade_id}", status_code=204)
def delete_trade(trade_id: int, db: Session = Depends(get_db)):
    """
    Delete a trade and all its legs permanently.
    Returns 204 No Content on success, 404 if not found.
    """
    trade = db.query(Trade).filter(Trade.id == trade_id).first()
    if not trade:
        raise HTTPException(status_code=404, detail=f"Trade {trade_id} not found")

    db.query(TradeLeg).filter(TradeLeg.trade_id == trade_id).delete()
    db.delete(trade)
    db.commit()
    logger.info(f"Trade deleted: id={trade_id}")


# ---------------------------------------------------------------------------
# POST /api/trades/{id}/close
# ---------------------------------------------------------------------------

@router.post("/trades/{trade_id}/close")
def close_trade(trade_id: int, db: Session = Depends(get_db)):
    """
    Close an open trade.

    Steps:
      1. Fetch current market price for each leg
      2. Calculate realized P&L
      3. Store exit prices on each leg
      4. Update trade: status=closed, exit_time, realized_pnl, return_pct
      5. Log activity event
      6. Update daily_pnl record if one exists for this trade
    """
    trade = db.query(Trade).filter(Trade.id == trade_id).first()
    if not trade:
        raise HTTPException(status_code=404, detail=f"Trade {trade_id} not found")
    if trade.status == "closed":
        raise HTTPException(status_code=400, detail="Trade is already closed")

    legs = db.query(TradeLeg).filter(TradeLeg.trade_id == trade_id).all()

    # Calculate realized P&L at current market prices
    realized_pnl = compute_unrealized_pnl(legs)

    # Store exit price on each leg
    for leg in legs:
        underlying   = resolve_symbol(leg.symbol)
        exit_price   = get_current_option_price(underlying, float(leg.strike), leg.option_type, leg.expiry)
        leg.exit_price = exit_price

    # Get exit underlying price
    try:
        quote    = get_quote(trade.underlying)
        exit_ltp = quote["ltp"]
    except Exception:
        exit_ltp = float(trade.entry_underlying_price)

    # Calculate return %
    capital        = float(trade.capital_deployed or 0)
    return_pct     = round((realized_pnl / capital) * 100, 4) if capital > 0 else 0.0

    # Update trade row
    trade.status                = "closed"
    trade.exit_time             = datetime.utcnow()
    trade.exit_underlying_price = exit_ltp
    trade.realized_pnl          = realized_pnl
    trade.unrealized_pnl        = 0
    trade.return_pct            = return_pct

    # Log activity event
    db.add(ActivityEvent(
        type="trade_closed",
        trade_id=trade.id,
        message=(
            f"Trade closed on {trade.underlying} | "
            f"P&L: ₹{realized_pnl:.2f} ({return_pct:.2f}% return)"
        ),
        pnl=realized_pnl,
        timestamp=datetime.utcnow(),
    ))

    # Update or create a daily_pnl record for this trade
    daily_record = db.query(DailyPnl).filter(DailyPnl.trade_id == trade_id).first()
    if daily_record:
        daily_record.realized_pnl = realized_pnl
        daily_record.return_pct   = return_pct
        daily_record.notes        = f"Closed at spot {exit_ltp}. P&L: ₹{realized_pnl:.2f}"
    else:
        today_str = datetime.utcnow().strftime("%Y-%m-%d")
        db.add(DailyPnl(
            date=today_str,
            underlying=trade.underlying,
            strategy_type=trade.strategy_type,
            strategy_frequency=trade.strategy_frequency,
            trade_id=trade.id,
            net_premium=float(trade.net_premium or 0),
            realized_pnl=realized_pnl,
            capital_deployed=float(trade.capital_deployed or 0),
            return_pct=return_pct,
            brokerage_cost=0,
            notes=f"Manual close at spot {exit_ltp}. P&L: ₹{realized_pnl:.2f}",
        ))

    db.commit()
    db.refresh(trade)
    updated_legs = db.query(TradeLeg).filter(TradeLeg.trade_id == trade_id).all()

    logger.info(f"Trade closed: id={trade_id} realized_pnl={realized_pnl}")
    return format_trade(trade, updated_legs)


# ---------------------------------------------------------------------------
# POST /api/trades/refresh-pnl
# ---------------------------------------------------------------------------

@router.post("/trades/refresh-pnl", response_model=RefreshPnlResponse)
def refresh_pnl(db: Session = Depends(get_db)):
    """
    Recalculate unrealized P&L for all open trades.

    Called by the frontend periodically (or on demand) to keep
    the P&L numbers up to date with current market prices.

    For each open trade:
      - Fetches current option price for each leg
      - Calculates unrealized P&L
      - Updates the trade row in the database
    """
    open_trades = db.query(Trade).filter(Trade.status == "open").all()
    refreshed   = 0

    for trade in open_trades:
        legs = db.query(TradeLeg).filter(TradeLeg.trade_id == trade.id).all()
        try:
            pnl = 0.0
            for leg in legs:
                underlying    = resolve_symbol(leg.symbol)
                price         = get_current_option_price(underlying, float(leg.strike), leg.option_type, leg.expiry)
                leg.current_price = price          # persist so format_leg is instant
                leg_pnl       = (price - float(leg.entry_price)) * leg.quantity * leg.lot_size
                if leg.action == "SELL":
                    leg_pnl   = -leg_pnl
                pnl           += leg_pnl
            trade.unrealized_pnl = round(pnl, 2)
            refreshed += 1
        except Exception as e:
            logger.warning(f"Could not refresh P&L for trade {trade.id}: {e}")

    db.commit()
    return {"refreshed": refreshed, "message": f"Refreshed P&L for {refreshed} open trades"}
