"""
services/seed_strategies.py — Inserts 6 preset strategies on first boot.

Why seed data?
  Without preset strategies, a new user opens the app and sees an empty list.
  These 6 strategies demonstrate all major strategy types with sensible defaults.
  They are all inactive (is_active=False) so nothing executes automatically.

When does this run?
  Called from main.py's startup event, before accepting any requests.
  It checks if the strategies table is empty first — if there are any rows,
  it does nothing (idempotent — safe to call multiple times).

The 6 presets:
  1. Nifty Weekly Iron Condor      — most common retail strategy
  2. Sensex Weekly Iron Condor     — Sensex variant (Friday expiry)
  3. Nifty Biweekly Iron Condor    — wider wing, more premium
  4. Sensex Biweekly Iron Condor
  5. BankNifty Monthly Iron Condor — lower frequency, more capital
  6. Intraday Expiry IC            — short straddle on expiry day
"""

from sqlalchemy.orm import Session
from core.database import SessionLocal
from models.db import Strategy
from core.logger import get_logger

logger = get_logger(__name__)

PRESET_STRATEGIES = [
    {
        "name":                   "Nifty Weekly Iron Condor",
        "strategy_type":          "IRON_CONDOR",
        "underlying":             "NIFTY",
        "frequency":              "WEEKLY",
        "is_active":              False,
        "lot_multiplier":         1,
        "wing_width":             200,
        "capital_per_trade":      90000,
        "target_return_pct":      1,
        "brokerage_cost":         300,
        "entry_time_ist":         "09:20",
        "exit_time_ist":          "15:15",
    },
    {
        "name":                   "Sensex Weekly Iron Condor",
        "strategy_type":          "IRON_CONDOR",
        "underlying":             "SENSEX",
        "frequency":              "WEEKLY",
        "is_active":              False,
        "lot_multiplier":         1,
        "wing_width":             500,
        "capital_per_trade":      90000,
        "target_return_pct":      1,
        "brokerage_cost":         300,
        "entry_time_ist":         "09:20",
        "exit_time_ist":          "15:15",
    },
    {
        "name":                   "Nifty Biweekly Iron Condor",
        "strategy_type":          "IRON_CONDOR",
        "underlying":             "NIFTY",
        "frequency":              "BIWEEKLY",
        "is_active":              False,
        "lot_multiplier":         1,
        "wing_width":             250,
        "capital_per_trade":      90000,
        "target_return_pct":      1,
        "brokerage_cost":         300,
        "entry_time_ist":         "09:20",
        "exit_time_ist":          "15:15",
    },
    {
        "name":                   "Sensex Biweekly Iron Condor",
        "strategy_type":          "IRON_CONDOR",
        "underlying":             "SENSEX",
        "frequency":              "BIWEEKLY",
        "is_active":              False,
        "lot_multiplier":         1,
        "wing_width":             600,
        "capital_per_trade":      90000,
        "target_return_pct":      1,
        "brokerage_cost":         300,
        "entry_time_ist":         "09:20",
        "exit_time_ist":          "15:15",
    },
    {
        "name":                   "BankNifty Monthly Iron Condor",
        "strategy_type":          "IRON_CONDOR",
        "underlying":             "BANKNIFTY",
        "frequency":              "MONTHLY",
        "is_active":              False,
        "lot_multiplier":         1,
        "wing_width":             500,
        "capital_per_trade":      90000,
        "target_return_pct":      1,
        "brokerage_cost":         300,
        "entry_time_ist":         "09:20",
        "exit_time_ist":          "15:15",
    },
    {
        "name":                   "Intraday Expiry IC",
        "strategy_type":          "INTRADAY_IC",
        "underlying":             "NIFTY",
        "frequency":              "INTRADAY",
        "is_active":              False,
        "lot_multiplier":         1,
        "max_buying_leg_premium": 5,
        "capital_per_trade":      90000,
        "target_return_pct":      1,
        "brokerage_cost":         300,
        "entry_time_ist":         "09:20",
        "exit_time_ist":          "15:20",
    },
]


async def seed_strategies_if_empty():
    """
    Insert 6 preset strategies if the table is empty.
    Called once at server startup from main.py.
    """
    db: Session = SessionLocal()
    try:
        existing_count = db.query(Strategy).count()
        if existing_count > 0:
            logger.info(f"Strategies table has {existing_count} rows — skipping seed")
            return

        logger.info("Strategies table is empty — seeding 6 preset strategies")
        for data in PRESET_STRATEGIES:
            db.add(Strategy(**data))
        db.commit()
        logger.info("Seeded 6 preset strategies successfully")
    except Exception as e:
        logger.error(f"Failed to seed strategies: {e}")
        db.rollback()
    finally:
        db.close()
