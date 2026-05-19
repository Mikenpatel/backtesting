"""
core/database.py — PostgreSQL connection setup using SQLAlchemy.

What this file does:
  1. Creates a connection pool (engine) using the DATABASE_URL from config
  2. Creates a SessionLocal factory — each request gets its own DB session
  3. Provides a `get_db()` dependency for FastAPI routes to use
  4. Provides `init_db()` called at startup to verify the connection works

What is a connection pool?
  Opening a new PostgreSQL connection takes ~50ms. With a pool, we open
  connections once at startup and reuse them. Each request borrows a
  connection from the pool and returns it when done.

What is a session?
  A SQLAlchemy session is a "unit of work" — it tracks all the DB objects
  you've loaded, accumulates your changes, and commits or rolls them back
  together. Each HTTP request should have its own session.

Usage in routes:
    from core.database import get_db
    from sqlalchemy.orm import Session
    from fastapi import Depends

    @router.get("/trades")
    def list_trades(db: Session = Depends(get_db)):
        return db.query(Trade).all()
"""

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session, DeclarativeBase
from core.config import settings
from core.logger import get_logger

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Engine — the connection pool
# ---------------------------------------------------------------------------
# pool_pre_ping=True: before using a connection from the pool, check it
# is still alive. Prevents errors after DB restarts.
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=5,         # keep 5 connections open
    max_overflow=10,    # allow up to 10 extra connections under load
    echo=True
)

# ---------------------------------------------------------------------------
# Session factory
# ---------------------------------------------------------------------------
# autocommit=False: changes must be explicitly committed (db.commit())
# autoflush=False:  SQLAlchemy won't auto-flush before queries
SessionLocal = sessionmaker(
    bind=engine,
    autocommit=False,
    autoflush=False,
)

# ---------------------------------------------------------------------------
# Base class for SQLAlchemy models
# ---------------------------------------------------------------------------
# All models in models/db.py inherit from this Base.
# SQLAlchemy uses it to track which Python classes map to which DB tables.
class Base(DeclarativeBase):
    pass


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------
def get_db():
    """
    FastAPI dependency that provides a database session.

    The `yield` keyword makes this a "generator dependency":
      - Code before yield runs before the route handler
      - The yielded value (db) is injected into the route
      - Code after yield (in finally) always runs after the route, even on error

    This guarantees the session is always closed, preventing connection leaks.

    Usage:
        @router.get("/trades")
        def list_trades(db: Session = Depends(get_db)):
            return db.query(Trade).all()
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ---------------------------------------------------------------------------
# Startup verification
# ---------------------------------------------------------------------------
def init_db():
    """
    Called once at server startup to verify the database connection works.
    Raises an exception if the database is unreachable.
    """
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        logger.info("Database connection verified")
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        raise
