"""
models/schemas.py — Pydantic request/response models.

What Pydantic does:
  1. Validates incoming request bodies — bad data → 422 error with clear message
  2. Serializes Python objects to JSON for responses
  3. Generates API documentation automatically at /docs

How to read these:
    class QuoteResponse(BaseModel):
        symbol: str          ← required field, must be a string
        ltp: float           ← required, must be a number
        vix: float = 0.0     ← optional, defaults to 0.0

Difference from models/db.py:
  DB models (db.py)      → describe what the DATABASE stores
  Pydantic models (here) → describe what the API sends/receives

They often look similar but are deliberately separate:
  - DB stores NUMERIC as Decimal strings → API returns float
  - DB has updated_at/created_at → API may not expose them
  - API accepts camelCase → DB uses snake_case
"""

from __future__ import annotations
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Market models
# ---------------------------------------------------------------------------

class QuoteResponse(BaseModel):
    """Response from GET /api/market/quote?symbol=NIFTY"""
    symbol:     str
    ltp:        float
    open:       float
    high:       float
    low:        float
    change:     float
    change_pct: float
    vix:        float
    timestamp:  str


class MarketModeResponse(BaseModel):
    """Response from GET /api/market/mode — powers the live/blocked/simulator badge"""
    mode:            str    # "live" | "blocked" | "simulator"
    has_credentials: bool
    reason:          str


class StrikeData(BaseModel):
    """One row in the option chain — both call and put for a given strike"""
    strike:      float
    call_ltp:    float
    call_oi:     int
    call_volume: int
    call_iv:     float
    call_delta:  float
    call_theta:  float
    call_vega:   float
    put_ltp:     float
    put_oi:      int
    put_volume:  int
    put_iv:      float
    put_delta:   float
    put_theta:   float
    put_vega:    float


class OptionChainResponse(BaseModel):
    """Response from GET /api/market/option-chain"""
    symbol:         str
    expiry:         str
    underlying_ltp: float
    atm_strike:     float
    strikes:        List[StrikeData]


# ---------------------------------------------------------------------------
# Trade models
# ---------------------------------------------------------------------------

class TradeLegCreate(BaseModel):
    """One leg when creating a new trade"""
    symbol:      str
    option_type: str    # CE | PE
    strike:      float
    expiry:      str
    action:      str    # BUY | SELL
    quantity:    int
    entry_price: float
    lot_size:    int


class TradeCreate(BaseModel):
    """Request body for POST /api/trades"""
    strategy_type:      str
    strategy_frequency: Optional[str] = None
    underlying:         str
    notes:              Optional[str] = None
    capital_deployed:   Optional[float] = None
    max_profit:         Optional[float] = None
    max_loss:           Optional[float] = None
    net_premium:        Optional[float] = None
    strategy_id:        Optional[int] = None
    legs:               List[TradeLegCreate]


class TradeUpdate(BaseModel):
    """Request body for PATCH /api/trades/:id — all fields optional"""
    notes:            Optional[str]   = None
    capital_deployed: Optional[float] = None
    max_profit:       Optional[float] = None
    max_loss:         Optional[float] = None
    status:           Optional[str]   = None


class TradeLegResponse(BaseModel):
    """One leg in a trade response"""
    id:            int
    trade_id:      int
    symbol:        str
    option_type:   str
    strike:        float
    expiry:        str
    action:        str
    quantity:      int
    entry_price:   float
    exit_price:    Optional[float]
    current_price: float
    lot_size:      int
    created_at:    str


class TradeResponse(BaseModel):
    """Full trade with all legs — response for GET /api/trades/:id"""
    id:                     int
    strategy_type:          str
    strategy_frequency:     Optional[str]
    underlying:             str
    status:                 str
    entry_time:             str
    exit_time:              Optional[str]
    entry_underlying_price: float
    exit_underlying_price:  Optional[float]
    unrealized_pnl:         float
    realized_pnl:           Optional[float]
    net_premium:            Optional[float]
    capital_deployed:       Optional[float]
    return_pct:             Optional[float]
    max_profit:             Optional[float]
    max_loss:               Optional[float]
    notes:                  Optional[str]
    legs:                   List[TradeLegResponse]
    created_at:             str
    updated_at:             str


# ---------------------------------------------------------------------------
# Strategy models
# ---------------------------------------------------------------------------

class StrategyCreate(BaseModel):
    """Request body for POST /api/strategies"""
    name:                   str
    strategy_type:          str
    underlying:             str
    frequency:              str
    is_active:              bool = False
    lot_multiplier:         int  = 1
    delta_target:           Optional[float] = None
    wing_width:             Optional[int]   = None
    stop_loss_pct:          Optional[float] = None
    target_profit_pct:      Optional[float] = None
    capital_per_trade:      float = 90000
    max_buying_leg_premium: float = 5
    target_return_pct:      float = 1
    brokerage_cost:         float = 300
    entry_time_ist:         Optional[str] = None
    exit_time_ist:          Optional[str] = None


class StrategyUpdate(BaseModel):
    """Request body for PATCH /api/strategies/:id — all optional"""
    name:                   Optional[str]   = None
    is_active:              Optional[bool]  = None
    lot_multiplier:         Optional[int]   = None
    delta_target:           Optional[float] = None
    wing_width:             Optional[int]   = None
    stop_loss_pct:          Optional[float] = None
    target_profit_pct:      Optional[float] = None
    capital_per_trade:      Optional[float] = None
    max_buying_leg_premium: Optional[float] = None
    target_return_pct:      Optional[float] = None
    brokerage_cost:         Optional[float] = None
    entry_time_ist:         Optional[str]   = None
    exit_time_ist:          Optional[str]   = None


class StrategyResponse(BaseModel):
    """Full strategy — response for GET /api/strategies"""
    id:                     int
    name:                   str
    strategy_type:          str
    underlying:             str
    frequency:              str
    is_active:              bool
    lot_multiplier:         int
    delta_target:           Optional[float]
    wing_width:             Optional[int]
    stop_loss_pct:          Optional[float]
    target_profit_pct:      Optional[float]
    capital_per_trade:      float
    max_buying_leg_premium: float
    target_return_pct:      float
    brokerage_cost:         float
    entry_time_ist:         Optional[str]
    exit_time_ist:          Optional[str]
    last_executed_at:       Optional[str]
    total_trades_placed:    int
    total_pnl:              float
    created_at:             str


# ---------------------------------------------------------------------------
# Dashboard models
# ---------------------------------------------------------------------------

class DashboardSummary(BaseModel):
    total_unrealized_pnl:   float
    total_realized_pnl:     float
    total_pnl:              float
    total_capital_deployed: float
    total_return_pct:       float
    open_trades:            int
    closed_trades:          int
    winning_trades:         int
    losing_trades:          int
    win_rate:               float
    avg_win:                float
    avg_loss:               float
    active_strategies:      int
    nifty_ltp:              float
    banknifty_ltp:          float
    vix:                    float
    today_pnl:              float


class PnlChartPoint(BaseModel):
    date:           str
    pnl:            float
    cumulative_pnl: float


class StrategyBreakdown(BaseModel):
    strategy_type: str
    trades:        int
    pnl:           float
    win_rate:      float
    return_pct:    float


class ActivityEvent(BaseModel):
    id:          int
    type:        str
    trade_id:    Optional[int]
    strategy_id: Optional[int]
    message:     str
    pnl:         Optional[float]
    timestamp:   str


class DailyPnlRow(BaseModel):
    id:                int
    date:              str
    underlying:        str
    strategy_type:     str
    strategy_frequency: Optional[str]
    trade_id:          Optional[int]
    net_premium:       float
    realized_pnl:      float
    capital_deployed:  float
    return_pct:        float
    brokerage_cost:    float
    cumulative_pnl:    float
    notes:             Optional[str]


class DailyPnlSummary(BaseModel):
    total_rows:             int
    total_net_premium:      float
    total_realized_pnl:     float
    total_capital_deployed: float
    total_brokerage_cost:   float
    overall_return_pct:     float


class DailyPnlResponse(BaseModel):
    rows:    List[DailyPnlRow]
    summary: DailyPnlSummary


class ByUnderlying(BaseModel):
    underlying:        str
    capital_deployed:  float
    pnl:               float
    return_pct:        float
    trades:            int


class CapitalSummary(BaseModel):
    active_capital:         float
    total_capital_deployed: float
    total_realized_pnl:     float
    total_unrealized_pnl:   float
    overall_return_pct:     float
    by_underlying:          List[ByUnderlying]


class RefreshPnlResponse(BaseModel):
    refreshed: int
    message:   str
