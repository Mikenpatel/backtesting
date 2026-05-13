"""
routes/dashboard.py — Portfolio analytics and summary endpoints.

Endpoints:
  GET /api/dashboard/summary           Portfolio overview (P&L, win rate, etc.)
  GET /api/dashboard/pnl-chart         30-day daily P&L series for Recharts
  GET /api/dashboard/strategy-breakdown P&L grouped by strategy type
  GET /api/dashboard/recent-activity   Last 10 activity events
  GET /api/dashboard/daily-pnl         Full daily P&L ledger with filters
  GET /api/dashboard/capital-summary   Capital deployed by underlying

These endpoints are read-only — they aggregate data from the DB.
No writes happen here. All calculations are done in Python, not in SQL,
to keep the queries simple and easy to understand.
"""

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from core.database import get_db
from models.db import Trade, Strategy, ActivityEvent, DailyPnl
from market.adapter import get_quote, get_vix
from core.logger import get_logger

logger = get_logger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# GET /api/dashboard/summary
# ---------------------------------------------------------------------------

@router.get("/dashboard/summary")
def dashboard_summary(db: Session = Depends(get_db)):
    """
    Portfolio overview — the main numbers shown at the top of the dashboard.

    Calculates:
      - Total unrealized P&L (sum of all open trades)
      - Total realized P&L (sum of all closed trades)
      - Win rate (% of closed trades with positive P&L)
      - Average win / average loss
      - Today's P&L
      - Live NIFTY and BANKNIFTY prices
      - VIX
    """
    all_trades = db.query(Trade).all()
    strategies = db.query(Strategy).filter(Strategy.is_active == True).all()

    open_trades   = [t for t in all_trades if t.status == "open"]
    closed_trades = [t for t in all_trades if t.status == "closed"]

    total_unrealized = sum(float(t.unrealized_pnl) for t in open_trades)
    total_realized   = sum(float(t.realized_pnl or 0) for t in closed_trades)
    total_pnl        = total_unrealized + total_realized

    total_capital = sum(float(t.capital_deployed or 0) for t in all_trades)
    total_return  = round((total_pnl / total_capital) * 100, 2) if total_capital > 0 else 0.0

    winning = [t for t in closed_trades if float(t.realized_pnl or 0) > 0]
    losing  = [t for t in closed_trades if float(t.realized_pnl or 0) <= 0]
    win_rate = round((len(winning) / len(closed_trades)) * 100, 1) if closed_trades else 0.0
    avg_win  = round(sum(float(t.realized_pnl or 0) for t in winning) / len(winning), 2) if winning else 0.0
    avg_loss = round(sum(float(t.realized_pnl or 0) for t in losing)  / len(losing),  2) if losing  else 0.0

    # Today's P&L = closed trades exited today + unrealized on trades opened today
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    today_closed    = [t for t in closed_trades if t.exit_time and t.exit_time.replace(tzinfo=timezone.utc) >= today]
    today_open_new  = [t for t in open_trades   if t.entry_time and t.entry_time.replace(tzinfo=timezone.utc) >= today]
    today_pnl = (
        sum(float(t.realized_pnl or 0) for t in today_closed)
        + sum(float(t.unrealized_pnl) for t in today_open_new)
    )

    # Fetch live index prices
    try:
        nifty_quote     = get_quote("NIFTY")
        banknifty_quote = get_quote("BANKNIFTY")
        nifty_ltp       = nifty_quote["ltp"]
        banknifty_ltp   = banknifty_quote["ltp"]
    except Exception as e:
        logger.warning(f"Could not fetch quotes for summary: {e}")
        nifty_ltp = banknifty_ltp = 0.0

    return {
        "total_unrealized_pnl":   round(total_unrealized, 2),
        "total_realized_pnl":     round(total_realized, 2),
        "total_pnl":              round(total_pnl, 2),
        "total_capital_deployed": round(total_capital, 2),
        "total_return_pct":       total_return,
        "open_trades":            len(open_trades),
        "closed_trades":          len(closed_trades),
        "winning_trades":         len(winning),
        "losing_trades":          len(losing),
        "win_rate":               win_rate,
        "avg_win":                avg_win,
        "avg_loss":               avg_loss,
        "active_strategies":      len(strategies),
        "nifty_ltp":              nifty_ltp,
        "banknifty_ltp":          banknifty_ltp,
        "vix":                    get_vix(),
        "today_pnl":              round(today_pnl, 2),
    }


# ---------------------------------------------------------------------------
# GET /api/dashboard/pnl-chart
# ---------------------------------------------------------------------------

@router.get("/dashboard/pnl-chart")
def pnl_chart(db: Session = Depends(get_db)):
    """
    30-day daily P&L series for the area chart on the dashboard.

    Returns a list of 30 points (one per day) with:
      - pnl:            P&L realised on that day
      - cumulative_pnl: running total from day 1

    Days with no closed trades show pnl=0 (ensures the chart has no gaps).
    """
    closed_trades = (
        db.query(Trade)
        .filter(Trade.status == "closed")
        .order_by(Trade.exit_time)
        .all()
    )

    # Group realized P&L by date string "YYYY-MM-DD"
    daily_map: dict[str, float] = {}
    for t in closed_trades:
        if not t.exit_time:
            continue
        date_key = t.exit_time.strftime("%Y-%m-%d")
        daily_map[date_key] = daily_map.get(date_key, 0) + float(t.realized_pnl or 0)

    # Build 30-day series
    today      = datetime.now(timezone.utc)
    points     = []
    cumulative = 0.0

    for i in range(29, -1, -1):
        from datetime import timedelta
        d        = today - timedelta(days=i)
        date_key = d.strftime("%Y-%m-%d")
        pnl      = daily_map.get(date_key, 0.0)
        cumulative += pnl
        points.append({
            "date":           date_key,
            "pnl":            round(pnl, 2),
            "cumulative_pnl": round(cumulative, 2),
        })

    return points


# ---------------------------------------------------------------------------
# GET /api/dashboard/strategy-breakdown
# ---------------------------------------------------------------------------

@router.get("/dashboard/strategy-breakdown")
def strategy_breakdown(db: Session = Depends(get_db)):
    """
    P&L grouped by strategy type — powers the pie/bar breakdown chart.

    Returns one row per strategy type with:
      - Total trades placed
      - Total realized P&L
      - Win rate
      - Overall return %
    """
    closed_trades = db.query(Trade).filter(Trade.status == "closed").all()

    by_type: dict[str, dict] = {}
    for t in closed_trades:
        pnl = float(t.realized_pnl or 0)
        cap = float(t.capital_deployed or 0)
        rec = by_type.setdefault(t.strategy_type, {"trades": 0, "pnl": 0.0, "wins": 0, "capital": 0.0})
        rec["trades"]  += 1
        rec["pnl"]     += pnl
        rec["wins"]    += 1 if pnl > 0 else 0
        rec["capital"] += cap

    return [
        {
            "strategy_type": stype,
            "trades":        d["trades"],
            "pnl":           round(d["pnl"], 2),
            "win_rate":      round((d["wins"] / d["trades"]) * 100, 1) if d["trades"] else 0.0,
            "return_pct":    round((d["pnl"] / d["capital"]) * 100, 2) if d["capital"] else 0.0,
        }
        for stype, d in by_type.items()
    ]


# ---------------------------------------------------------------------------
# GET /api/dashboard/recent-activity
# ---------------------------------------------------------------------------

@router.get("/dashboard/recent-activity")
def recent_activity(db: Session = Depends(get_db)):
    """
    Last 10 activity events — the "Recent Activity" feed on the dashboard.

    Events are created automatically by trades/strategies routes when:
      - A trade is opened
      - A trade is closed (includes P&L)
      - A strategy is executed
    """
    events = (
        db.query(ActivityEvent)
        .order_by(ActivityEvent.timestamp.desc())
        .limit(10)
        .all()
    )

    return [
        {
            "id":          e.id,
            "type":        e.type,
            "trade_id":    e.trade_id,
            "strategy_id": e.strategy_id,
            "message":     e.message,
            "pnl":         float(e.pnl) if e.pnl is not None else None,
            "timestamp":   e.timestamp.isoformat() if e.timestamp else None,
        }
        for e in events
    ]


# ---------------------------------------------------------------------------
# GET /api/dashboard/daily-pnl
# ---------------------------------------------------------------------------

@router.get("/dashboard/daily-pnl")
def daily_pnl(
    from_date:  Optional[str] = Query(default=None, alias="from"),
    to_date:    Optional[str] = Query(default=None, alias="to"),
    underlying: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    """
    Full daily P&L ledger with optional filters.

    Query params:
      ?from=2026-05-01  ← filter from this date (inclusive)
      ?to=2026-05-13    ← filter to this date (inclusive)
      ?underlying=NIFTY ← filter by underlying

    Returns rows in chronological order with a running cumulative total.
    Also includes a summary row with totals across all returned rows.
    """
    rows = db.query(DailyPnl).order_by(DailyPnl.date.desc()).all()

    # Apply filters in Python (simple, avoids SQLAlchemy dynamic query complexity)
    if from_date:
        rows = [r for r in rows if r.date >= from_date]
    if to_date:
        rows = [r for r in rows if r.date <= to_date]
    if underlying:
        rows = [r for r in rows if r.underlying == underlying]

    # Reverse to chronological for cumulative calculation
    rows = list(reversed(rows))

    running_pnl = 0.0
    result      = []
    for r in rows:
        realized    = float(r.realized_pnl)
        running_pnl += realized
        capital     = float(r.capital_deployed)
        return_pct  = round((realized / capital) * 100, 2) if capital > 0 else 0.0

        result.append({
            "id":                r.id,
            "date":              r.date,
            "underlying":        r.underlying,
            "strategy_type":     r.strategy_type,
            "strategy_frequency": r.strategy_frequency,
            "trade_id":          r.trade_id,
            "net_premium":       float(r.net_premium),
            "realized_pnl":      realized,
            "capital_deployed":  capital,
            "return_pct":        return_pct,
            "brokerage_cost":    float(r.brokerage_cost),
            "cumulative_pnl":    round(running_pnl, 2),
            "notes":             r.notes,
        })

    # Reverse back to newest-first for display
    result = list(reversed(result))

    total_capital   = sum(r["capital_deployed"] for r in result)
    total_pnl       = sum(r["realized_pnl"]     for r in result)
    total_premium   = sum(r["net_premium"]       for r in result)
    total_brokerage = sum(r["brokerage_cost"]    for r in result)

    return {
        "rows":    result,
        "summary": {
            "total_rows":             len(result),
            "total_net_premium":      round(total_premium, 2),
            "total_realized_pnl":     round(total_pnl, 2),
            "total_capital_deployed": round(total_capital, 2),
            "total_brokerage_cost":   round(total_brokerage, 2),
            "overall_return_pct":     round((total_pnl / total_capital) * 100, 2) if total_capital else 0.0,
        },
    }


# ---------------------------------------------------------------------------
# GET /api/dashboard/capital-summary
# ---------------------------------------------------------------------------

@router.get("/dashboard/capital-summary")
def capital_summary(db: Session = Depends(get_db)):
    """
    Capital allocation overview — how much capital is deployed where.

    Returns:
      - Total capital currently active (in open trades)
      - All-time capital deployed
      - Realized + unrealized P&L totals
      - Breakdown by underlying (NIFTY, BANKNIFTY, etc.)
    """
    all_trades    = db.query(Trade).all()
    open_trades   = [t for t in all_trades if t.status == "open"]
    closed_trades = [t for t in all_trades if t.status == "closed"]

    active_capital   = sum(float(t.capital_deployed or 0) for t in open_trades)
    total_capital    = sum(float(t.capital_deployed or 0) for t in all_trades)
    total_realized   = sum(float(t.realized_pnl or 0)    for t in closed_trades)
    total_unrealized = sum(float(t.unrealized_pnl)        for t in open_trades)

    by_underlying: dict[str, dict] = {}
    for t in all_trades:
        pnl = float(t.realized_pnl or 0) if t.status == "closed" else float(t.unrealized_pnl)
        rec = by_underlying.setdefault(t.underlying, {"capital": 0.0, "pnl": 0.0, "trades": 0})
        rec["capital"] += float(t.capital_deployed or 0)
        rec["pnl"]     += pnl
        rec["trades"]  += 1

    total_pnl = total_realized + total_unrealized

    return {
        "active_capital":          round(active_capital, 2),
        "total_capital_deployed":  round(total_capital, 2),
        "total_realized_pnl":      round(total_realized, 2),
        "total_unrealized_pnl":    round(total_unrealized, 2),
        "overall_return_pct":      round((total_pnl / total_capital) * 100, 2) if total_capital else 0.0,
        "by_underlying": [
            {
                "underlying":       u,
                "capital_deployed": round(d["capital"], 2),
                "pnl":              round(d["pnl"], 2),
                "return_pct":       round((d["pnl"] / d["capital"]) * 100, 2) if d["capital"] else 0.0,
                "trades":           d["trades"],
            }
            for u, d in by_underlying.items()
        ],
    }
