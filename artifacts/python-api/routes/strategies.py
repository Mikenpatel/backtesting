"""
routes/strategies.py — Strategy CRUD and execution endpoints.

Endpoints:
  GET    /api/strategies           List all strategies
  POST   /api/strategies           Create a new strategy
  PATCH  /api/strategies/{id}      Update strategy settings
  DELETE /api/strategies/{id}      Delete a strategy
  POST   /api/strategies/{id}/execute  Execute strategy now (creates a trade)
  POST   /api/strategies/{id}/toggle   Toggle auto-execution on/off

Strategy execution flow:
  1. Load strategy from DB
  2. Get available expiries → select target expiry based on frequency
  3. Find option legs (Iron Condor or Intraday IC)
  4. Create trade + legs in DB
  5. Record daily_pnl entry for tracking
  6. Log activity event
  7. Return the created trade

All market data calls go through market/adapter.py → live or simulator.
"""

from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from core.database import get_db
from models.db import Strategy, Trade, TradeLeg, ActivityEvent, DailyPnl
from models.schemas import StrategyCreate, StrategyUpdate, StrategyResponse
from market.adapter import get_quote, get_expiries, find_iron_condor_legs, find_intraday_ic_legs
from core.logger import get_logger

logger = get_logger(__name__)
router = APIRouter()


def _format_strategy(s: Strategy) -> dict:
    """Convert a Strategy DB row to the API response shape."""
    return {
        "id":                     s.id,
        "name":                   s.name,
        "strategy_type":          s.strategy_type,
        "underlying":             s.underlying,
        "frequency":              s.frequency,
        "is_active":              s.is_active,
        "lot_multiplier":         s.lot_multiplier,
        "delta_target":           float(s.delta_target) if s.delta_target else None,
        "wing_width":             s.wing_width,
        "stop_loss_pct":          float(s.stop_loss_pct) if s.stop_loss_pct else None,
        "target_profit_pct":      float(s.target_profit_pct) if s.target_profit_pct else None,
        "capital_per_trade":      float(s.capital_per_trade or 90000),
        "max_buying_leg_premium": float(s.max_buying_leg_premium or 5),
        "target_return_pct":      float(s.target_return_pct or 1),
        "brokerage_cost":         float(s.brokerage_cost or 300),
        "entry_time_ist":         s.entry_time_ist,
        "exit_time_ist":          s.exit_time_ist,
        "last_executed_at":       s.last_executed_at.isoformat() if s.last_executed_at else None,
        "total_trades_placed":    s.total_trades_placed,
        "total_pnl":              float(s.total_pnl),
        "created_at":             s.created_at.isoformat() if s.created_at else None,
    }


# ---------------------------------------------------------------------------
# GET /api/strategies
# ---------------------------------------------------------------------------

@router.get("/strategies")
def list_strategies(db: Session = Depends(get_db)):
    """List all strategies, most recently created first."""
    strategies = db.query(Strategy).order_by(Strategy.created_at.desc()).all()
    return [_format_strategy(s) for s in strategies]


# ---------------------------------------------------------------------------
# POST /api/strategies
# ---------------------------------------------------------------------------

@router.post("/strategies", status_code=201)
def create_strategy(body: StrategyCreate, db: Session = Depends(get_db)):
    """Create a new strategy configuration."""
    strategy = Strategy(**body.model_dump())
    db.add(strategy)
    db.commit()
    db.refresh(strategy)
    logger.info(f"Strategy created: id={strategy.id} name={strategy.name}")
    return _format_strategy(strategy)


# ---------------------------------------------------------------------------
# GET /api/strategies/{id}
# ---------------------------------------------------------------------------

@router.get("/strategies/{strategy_id}")
def get_strategy(strategy_id: int, db: Session = Depends(get_db)):
    """Get a single strategy by ID."""
    strategy = db.query(Strategy).filter(Strategy.id == strategy_id).first()
    if not strategy:
        raise HTTPException(status_code=404, detail=f"Strategy {strategy_id} not found")
    return _format_strategy(strategy)


# ---------------------------------------------------------------------------
# PATCH /api/strategies/{id}
# ---------------------------------------------------------------------------

@router.patch("/strategies/{strategy_id}")
def update_strategy(strategy_id: int, body: StrategyUpdate, db: Session = Depends(get_db)):
    """Update strategy settings. Only provided fields are changed."""
    strategy = db.query(Strategy).filter(Strategy.id == strategy_id).first()
    if not strategy:
        raise HTTPException(status_code=404, detail=f"Strategy {strategy_id} not found")

    for field, value in body.model_dump(exclude_none=True).items():
        setattr(strategy, field, value)

    db.commit()
    db.refresh(strategy)
    return _format_strategy(strategy)


# ---------------------------------------------------------------------------
# DELETE /api/strategies/{id}
# ---------------------------------------------------------------------------

@router.delete("/strategies/{strategy_id}", status_code=204)
def delete_strategy(strategy_id: int, db: Session = Depends(get_db)):
    """Delete a strategy permanently."""
    strategy = db.query(Strategy).filter(Strategy.id == strategy_id).first()
    if not strategy:
        raise HTTPException(status_code=404, detail=f"Strategy {strategy_id} not found")

    db.delete(strategy)
    db.commit()
    logger.info(f"Strategy deleted: id={strategy_id}")


# ---------------------------------------------------------------------------
# POST /api/strategies/{id}/execute
# ---------------------------------------------------------------------------

@router.post("/strategies/{strategy_id}/execute", status_code=201)
def execute_strategy(strategy_id: int, db: Session = Depends(get_db)):
    """
    Execute a strategy immediately — creates a live paper trade.

    How expiry selection works:
      WEEKLY   → nearest upcoming expiry
      BIWEEKLY → second upcoming expiry
      MONTHLY  → next last-Thursday-of-month expiry
      INTRADAY → today's expiry (must be expiry day)

    How legs are selected:
      IRON_CONDOR → find_iron_condor_legs() from market/adapter.py
      INTRADAY_IC → find_intraday_ic_legs() from market/adapter.py
    """
    strategy = db.query(Strategy).filter(Strategy.id == strategy_id).first()
    if not strategy:
        raise HTTPException(status_code=404, detail=f"Strategy {strategy_id} not found")

    # Select target expiry based on frequency
    expiries = get_expiries(strategy.underlying)
    if not expiries:
        raise HTTPException(status_code=502, detail="Could not fetch expiry dates")

    freq = strategy.frequency
    if freq == "BIWEEKLY" and len(expiries) >= 2:
        target_expiry = expiries[1]
    elif freq == "MONTHLY":
        target_expiry = next((e for i, e in enumerate(expiries) if i >= 2), expiries[-1])
    else:
        target_expiry = expiries[0]

    capital_per_trade      = float(strategy.capital_per_trade or 90000)
    target_return_pct      = float(strategy.target_return_pct or 1)
    brokerage_cost         = float(strategy.brokerage_cost or 300)
    max_buying_leg_premium = float(strategy.max_buying_leg_premium or 5)
    wing_width             = strategy.wing_width or 200

    # Find option legs based on strategy type
    if strategy.strategy_type in ("INTRADAY_IC",) or freq == "INTRADAY":
        leg_result = find_intraday_ic_legs(
            strategy.underlying, target_expiry,
            capital_per_trade, target_return_pct,
            brokerage_cost, max_buying_leg_premium,
        )
        max_profit = leg_result.get("target_pnl")
        max_loss   = None
    else:
        leg_result = find_iron_condor_legs(
            strategy.underlying, target_expiry,
            wing_width, strategy.lot_multiplier,
        )
        max_profit = leg_result["max_profit"]
        max_loss   = leg_result["max_loss"]

    legs_data  = leg_result["legs"]
    net_credit = leg_result["net_credit"]

    # Get current underlying price for trade entry record
    try:
        quote = get_quote(strategy.underlying)
        entry_ltp = quote["ltp"]
    except Exception:
        entry_ltp = 0.0

    date_key = datetime.utcnow().strftime("%Y-%m-%d")

    # Create trade
    trade = Trade(
        strategy_type=strategy.strategy_type,
        strategy_frequency=None if freq == "INTRADAY" else freq,
        underlying=strategy.underlying,
        status="open",
        entry_underlying_price=entry_ltp,
        unrealized_pnl=0,
        max_profit=max_profit,
        max_loss=max_loss,
        net_premium=net_credit,
        capital_deployed=capital_per_trade,
        strategy_id=strategy.id,
    )
    db.add(trade)
    db.flush()

    # Create legs
    legs = []
    for leg_data in legs_data:
        leg = TradeLeg(
            trade_id=trade.id,
            symbol=f"{strategy.underlying}{leg_data['expiry']}{int(leg_data['strike'])}{leg_data['option_type']}",
            option_type=leg_data["option_type"],
            strike=leg_data["strike"],
            expiry=leg_data["expiry"],
            action=leg_data["action"],
            quantity=leg_data["quantity"],
            entry_price=leg_data["entry_price"],
            current_price=leg_data["current_price"],
            lot_size=leg_data["lot_size"],
        )
        db.add(leg)
        legs.append(leg)

    # Update strategy counters
    strategy.last_executed_at    = datetime.utcnow()
    strategy.total_trades_placed = (strategy.total_trades_placed or 0) + 1

    # Log activity event
    db.add(ActivityEvent(
        type="strategy_executed",
        trade_id=trade.id,
        strategy_id=strategy.id,
        message=(
            f"{strategy.name} executed: {strategy.strategy_type} on "
            f"{strategy.underlying} (net ₹{net_credit:.2f}/lot)"
        ),
        timestamp=datetime.utcnow(),
    ))

    # Create daily P&L record
    db.add(DailyPnl(
        date=date_key,
        underlying=strategy.underlying,
        strategy_type=strategy.strategy_type,
        strategy_frequency=None if freq == "INTRADAY" else freq,
        trade_id=trade.id,
        net_premium=net_credit,
        realized_pnl=0,
        capital_deployed=capital_per_trade,
        return_pct=0,
        brokerage_cost=brokerage_cost,
        notes=f"Entry at spot {entry_ltp}. Target expiry: {target_expiry}.",
    ))

    db.commit()
    db.refresh(trade)

    logger.info(
        f"Strategy executed: id={strategy.id} trade_id={trade.id} "
        f"net_credit={net_credit}"
    )

    # Build response
    formatted_legs = []
    for leg in legs:
        db.refresh(leg)
        formatted_legs.append({
            "id":            leg.id,
            "trade_id":      leg.trade_id,
            "symbol":        leg.symbol,
            "option_type":   leg.option_type,
            "strike":        float(leg.strike),
            "expiry":        leg.expiry,
            "action":        leg.action,
            "quantity":      leg.quantity,
            "entry_price":   float(leg.entry_price),
            "exit_price":    None,
            "current_price": float(leg.current_price),
            "lot_size":      leg.lot_size,
            "created_at":    leg.created_at.isoformat() if leg.created_at else None,
        })

    return {
        "id":                     trade.id,
        "strategy_type":          trade.strategy_type,
        "strategy_frequency":     trade.strategy_frequency,
        "underlying":             trade.underlying,
        "status":                 trade.status,
        "entry_time":             trade.entry_time.isoformat() if trade.entry_time else None,
        "exit_time":              None,
        "entry_underlying_price": float(trade.entry_underlying_price),
        "exit_underlying_price":  None,
        "unrealized_pnl":         0.0,
        "realized_pnl":           None,
        "net_premium":            net_credit,
        "capital_deployed":       capital_per_trade,
        "max_profit":             max_profit,
        "max_loss":               max_loss,
        "notes":                  None,
        "legs":                   formatted_legs,
        "created_at":             trade.created_at.isoformat() if trade.created_at else None,
        "updated_at":             trade.updated_at.isoformat() if trade.updated_at else None,
    }


# ---------------------------------------------------------------------------
# POST /api/strategies/{id}/toggle
# ---------------------------------------------------------------------------

@router.post("/strategies/{strategy_id}/toggle")
def toggle_strategy(strategy_id: int, db: Session = Depends(get_db)):
    """
    Toggle auto-execution on or off for a strategy.

    is_active=True  → strategy auto-executes based on entry_time_ist
    is_active=False → strategy only executes when /execute is called manually
    """
    strategy = db.query(Strategy).filter(Strategy.id == strategy_id).first()
    if not strategy:
        raise HTTPException(status_code=404, detail=f"Strategy {strategy_id} not found")

    strategy.is_active = not strategy.is_active
    db.commit()
    db.refresh(strategy)

    logger.info(f"Strategy {strategy_id} toggled: is_active={strategy.is_active}")
    return _format_strategy(strategy)
