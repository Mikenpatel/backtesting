"""
models/db.py — SQLAlchemy table definitions.

These classes tell SQLAlchemy how Python objects map to PostgreSQL tables.
Each class = one table. Each attribute = one column.

Why does this look different from Pydantic models (schemas.py)?
  - These classes (SQLAlchemy models) represent DATABASE rows
  - Pydantic models (schemas.py) represent API request/response shapes
  - They are deliberately separate because the DB shape and API shape
    are often different (e.g. DB uses NUMERIC strings, API uses floats)

How to read a column definition:
    id = Column(Integer, primary_key=True)
    ↑     ↑       ↑        ↑
    name  type   DB type   constraint

    status = Column(String, nullable=False, default="open")
    ↑                               ↑           ↑
    name                         no NULLs    Python default

IMPORTANT: The table names (e.g. "trades", "trade_legs") must exactly match
the PostgreSQL tables created by the Drizzle ORM in the Node.js backend.
No migration is needed — we share the same database.

Usage:
    from models.db import Trade, TradeLeg, Strategy
    from core.database import get_db
    from fastapi import Depends

    @router.get("/trades")
    def list_trades(db = Depends(get_db)):
        return db.query(Trade).filter(Trade.status == "open").all()
"""

from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Boolean, Numeric, DateTime, Text, func
)
from core.database import Base


class Trade(Base):
    """
    Represents one paper trade — e.g. one Iron Condor position.
    Related legs are in the TradeLeg table (one-to-many).
    """
    __tablename__ = "trades"

    id                    = Column(Integer, primary_key=True)
    strategy_type         = Column(String, nullable=False)     # IRON_CONDOR, INTRADAY_IC, etc.
    strategy_frequency    = Column(String)                     # WEEKLY, BIWEEKLY, MONTHLY, INTRADAY
    underlying            = Column(String, nullable=False)     # NIFTY, BANKNIFTY, FINNIFTY, SENSEX
    status                = Column(String, nullable=False, default="open")   # open | closed
    entry_time            = Column(DateTime(timezone=True), nullable=False, default=func.now())
    exit_time             = Column(DateTime(timezone=True))
    entry_underlying_price = Column(Numeric(10, 2), nullable=False)
    exit_underlying_price  = Column(Numeric(10, 2))
    unrealized_pnl        = Column(Numeric(12, 2), nullable=False, default=0)
    realized_pnl          = Column(Numeric(12, 2))
    max_profit            = Column(Numeric(12, 2))
    max_loss              = Column(Numeric(12, 2))
    net_premium           = Column(Numeric(10, 2))
    capital_deployed      = Column(Numeric(12, 2))
    return_pct            = Column(Numeric(8, 4))
    notes                 = Column(Text)
    strategy_id           = Column(Integer)
    created_at            = Column(DateTime(timezone=True), nullable=False, default=func.now())
    updated_at            = Column(DateTime(timezone=True), nullable=False, default=func.now(), onupdate=func.now())


class TradeLeg(Base):
    """
    One leg of a multi-leg option trade.
    An Iron Condor has 4 legs: sell call, buy call, sell put, buy put.
    """
    __tablename__ = "trade_legs"

    id           = Column(Integer, primary_key=True)
    trade_id     = Column(Integer, nullable=False)    # FK → trades.id
    symbol       = Column(String, nullable=False)     # e.g. "NIFTY26MAY24500CE"
    option_type  = Column(String, nullable=False)     # CE | PE
    strike       = Column(Numeric(10, 2), nullable=False)
    expiry       = Column(String, nullable=False)     # e.g. "14MAY26"
    action       = Column(String, nullable=False)     # BUY | SELL
    quantity     = Column(Integer, nullable=False)    # number of lots
    entry_price  = Column(Numeric(10, 2), nullable=False)
    exit_price   = Column(Numeric(10, 2))
    current_price = Column(Numeric(10, 2), nullable=False)
    lot_size     = Column(Integer, nullable=False)    # e.g. 75 for NIFTY
    created_at   = Column(DateTime(timezone=True), nullable=False, default=func.now())


class Strategy(Base):
    """
    A preset strategy configuration.
    Strategies can be auto-executed (is_active=True) or run on demand.
    """
    __tablename__ = "strategies"

    id                   = Column(Integer, primary_key=True)
    name                 = Column(String, nullable=False)      # e.g. "Nifty Weekly Iron Condor"
    strategy_type        = Column(String, nullable=False)
    underlying           = Column(String, nullable=False)
    frequency            = Column(String, nullable=False)      # WEEKLY, BIWEEKLY, MONTHLY, INTRADAY
    is_active            = Column(Boolean, nullable=False, default=False)
    lot_multiplier       = Column(Integer, nullable=False, default=1)
    delta_target         = Column(Numeric(5, 2))
    wing_width           = Column(Integer)                     # Iron Condor wing width in points
    stop_loss_pct        = Column(Numeric(5, 2))
    target_profit_pct    = Column(Numeric(5, 2))
    capital_per_trade    = Column(Numeric(12, 2), default=90000)
    max_buying_leg_premium = Column(Numeric(6, 2), default=5)
    target_return_pct    = Column(Numeric(5, 2), default=1)
    brokerage_cost       = Column(Numeric(8, 2), default=300)
    entry_time_ist       = Column(String)                      # e.g. "09:20"
    exit_time_ist        = Column(String)                      # e.g. "15:15"
    last_executed_at     = Column(DateTime(timezone=True))
    total_trades_placed  = Column(Integer, nullable=False, default=0)
    total_pnl            = Column(Numeric(12, 2), nullable=False, default=0)
    created_at           = Column(DateTime(timezone=True), nullable=False, default=func.now())
    updated_at           = Column(DateTime(timezone=True), nullable=False, default=func.now(), onupdate=func.now())


class ActivityEvent(Base):
    """
    Audit log of all significant events (trade opened, closed, strategy executed).
    Drives the "Recent Activity" feed on the dashboard.
    """
    __tablename__ = "activity_events"

    id          = Column(Integer, primary_key=True)
    type        = Column(String, nullable=False)    # trade_opened | trade_closed | strategy_executed | pnl_updated
    trade_id    = Column(Integer)
    strategy_id = Column(Integer)
    message     = Column(Text, nullable=False)
    pnl         = Column(Numeric(12, 2))
    timestamp   = Column(DateTime(timezone=True), nullable=False, default=func.now())


class DailyPnl(Base):
    """
    Daily P&L ledger — one row per trade per day.
    Powers the P&L chart and the detailed daily P&L table.
    """
    __tablename__ = "daily_pnl"

    id                = Column(Integer, primary_key=True)
    date              = Column(String, nullable=False)       # "2026-05-13"
    underlying        = Column(String, nullable=False)
    strategy_type     = Column(String, nullable=False)
    strategy_frequency = Column(String)
    trade_id          = Column(Integer)
    net_premium       = Column(Numeric(10, 2), nullable=False, default=0)
    realized_pnl      = Column(Numeric(12, 2), nullable=False, default=0)
    capital_deployed  = Column(Numeric(12, 2), nullable=False, default=0)
    return_pct        = Column(Numeric(8, 4), nullable=False, default=0)
    brokerage_cost    = Column(Numeric(10, 2), nullable=False, default=300)
    notes             = Column(Text)
    created_at        = Column(DateTime(timezone=True), nullable=False, default=func.now())
