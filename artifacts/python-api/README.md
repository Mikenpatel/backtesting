# Indian Options Paper Trader — Python FastAPI Backend

> This document covers **everything**: why we made every decision, how the code is structured,
> what each design pattern means in plain English, and how to run it.
> If you are new to Python or FastAPI, start at Part 1 and read top to bottom.

---

## Table of Contents

1. [Why we rewrote the backend in Python](#1-why-we-rewrote-the-backend-in-python)
2. [Why FastAPI specifically](#2-why-fastapi-specifically)
3. [Why WebSocket instead of REST polling](#3-why-websocket-instead-of-rest-polling)
4. [Architecture — the big picture](#4-architecture--the-big-picture)
5. [Design patterns used and why](#5-design-patterns-used-and-why)
6. [Project structure — how to read the code](#6-project-structure--how-to-read-the-code)
7. [FastAPI concepts explained for beginners](#7-fastapi-concepts-explained-for-beginners)
8. [Running locally — step by step](#8-running-locally--step-by-step)
9. [Environment variables reference](#9-environment-variables-reference)
10. [How the Fyers connection works](#10-how-the-fyers-connection-works)
11. [How the WebSocket feed works](#11-how-the-websocket-feed-works)
12. [The in-memory price cache](#12-the-in-memory-price-cache)
13. [The simulator fallback](#13-the-simulator-fallback)
14. [Database schema](#14-database-schema)
15. [API endpoints reference](#15-api-endpoints-reference)
16. [Extending this project](#16-extending-this-project)

---

## 1. Why we rewrote the backend in Python

The original backend was Node.js (Express). It worked, but had three friction points:

**Problem 1 — Manual Fyers API client**
The Node.js version had 266 lines of hand-written code just to call the Fyers API correctly:
building the right URL, setting the right headers, parsing the response, handling errors.
Fyers publishes an official Python SDK (`fyers_apiv3`) that does all of this in 3 lines.

**Problem 2 — Black-Scholes math**
Options pricing requires heavy floating-point math. Pure JavaScript handles it, but slowly.
Python's `numpy` library does the same math using C under the hood — 10 to 100 times faster.

**Problem 3 — WebSocket ecosystem**
The entire Indian algo-trading community uses Python. Every Fyers example, every options
pricing library, every NSE data source is Python-first. The Fyers WebSocket SDK is Python only.

---

## 2. Why FastAPI specifically

FastAPI is the modern standard for Python APIs. Here is what that means practically:

**Automatic documentation**
When you run the server, go to `http://localhost:8000/docs`. You get a full interactive
API explorer — every endpoint listed, every request/response shape documented, and a
"Try it out" button for each one. No Postman needed.

**Pydantic validation**
You declare the shape of your request and response data using Python classes. FastAPI
automatically validates incoming requests and returns clear error messages for bad input.
This is the Python equivalent of Zod in the old TypeScript codebase.

**Async support built in**
FastAPI handles thousands of simultaneous connections efficiently. When one request is
waiting for the database, FastAPI handles other requests in the meantime.

**Production ready**
FastAPI powers Instagram, Uber, and Microsoft internal tooling. It is not a toy framework.

---

## 3. Why WebSocket instead of REST polling

**The old approach (REST polling):**
```
Every 15 seconds:
  Frontend → "GET /api/market/quote?symbol=NIFTY" → Backend → Fyers API → response
```
Problems:
- Prices are always up to 15 seconds stale
- During market hours, NIFTY can move 50 points in 15 seconds (one full strike width)
- Every frontend tab opens its own connection to Fyers — rate limits hit quickly

**The new approach (WebSocket):**
```
Startup:
  Backend opens ONE connection to Fyers WebSocket → receives every tick
  Price cache updated on every tick (microseconds)

Client connects:
  Frontend opens ONE WebSocket to our backend
  Backend pushes new prices the moment Fyers sends them
  Zero polling, zero stale data
```
Benefits:
- Prices arrive within 100ms of the actual trade on NSE
- 1 Fyers connection regardless of how many browser tabs are open
- Foundation for auto-execution triggers (e.g., "sell when NIFTY crosses 24,200")

---

## 4. Architecture — the big picture

```
┌─────────────────────────────────────────────────────────────────┐
│                         EXCHANGE (NSE/BSE)                      │
└─────────────────────────┬───────────────────────────────────────┘
                          │ live ticks (every trade)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    FYERS SERVERS                                │
│  wss://socket.fyers.in/trade/v3/   ←  WebSocket feed           │
│  https://api-t1.fyers.in/data/     ←  REST API (option chain)  │
└──────────┬──────────────────────────┬───────────────────────────┘
           │ WebSocket ticks          │ REST (option chain, expiries)
           ▼                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                   OUR PYTHON FASTAPI SERVER                     │
│                                                                 │
│  fyers/websocket.py  ← receives ticks, runs in background       │
│         │                                                       │
│         ▼                                                       │
│  market/cache.py     ← in-memory dict, always has latest price  │
│         │                                                       │
│         ▼                                                       │
│  routes/ws.py        ← pushes cache to connected browsers       │
│                                                                 │
│  routes/market.py    ← REST: option chain, expiries, mode       │
│  routes/trades.py    ← REST: CRUD for trades and legs           │
│  routes/strategies.py← REST: CRUD + execute strategies          │
│  routes/dashboard.py ← REST: P&L summary, charts               │
│                                                                 │
│  models/db.py        ← SQLAlchemy table definitions             │
│  core/database.py    ← PostgreSQL connection pool               │
└──────────┬───────────────────────────────────────────────────────┘
           │ WebSocket (prices)  +  REST (everything else)
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   REACT FRONTEND (unchanged)                    │
│  useWebSocket() hook  ← replaces polling for prices             │
│  React Query hooks    ← still used for trades, strategies, P&L  │
└─────────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                   POSTGRESQL DATABASE                           │
│  trades, trade_legs, strategies, activity_events, daily_pnl     │
│  (same schema as before — no migration needed)                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Design patterns used and why

### Pattern 1: Three-Layer Architecture

Every feature passes through exactly three layers:

```
Layer 1 — Transport:   Fyers WebSocket and REST SDK (fyers/ folder)
Layer 2 — Domain:      Business logic, P&L math, strategy rules (market/, services/)
Layer 3 — API surface: FastAPI routes that serve the frontend (routes/)
```

**Why?** If Fyers changes their API format, you only touch Layer 1.
If you add a mobile app, you only add Layer 3 routes. Layer 2 never changes.

### Pattern 2: Singleton (Price Cache)

The price cache (`market/cache.py`) is a single module-level dictionary.
Python modules are loaded once and shared across all imports.
This means every route handler, every WebSocket connection, every background
task reads from the same dict — one source of truth.

```python
# market/cache.py
_cache: dict = {}          # ← created once when module loads

def update(symbol, data):  # ← Fyers WebSocket calls this
    _cache[symbol] = data

def get(symbol):           # ← every route handler calls this
    return _cache.get(symbol)
```

**Why not a class with `__init__`?** Because then you'd need to pass the instance
everywhere. A module IS a singleton in Python — no instantiation needed.

### Pattern 3: Dependency Injection (FastAPI `Depends`)

FastAPI routes declare what they need:

```python
# routes/trades.py
@router.get("/trades")
def list_trades(db: Session = Depends(get_db)):
    # `db` is automatically created, passed in, and cleaned up by FastAPI
    # you never call get_db() yourself
    return db.query(Trade).all()
```

**Why?** Because `list_trades` can now be tested by passing any mock `db` object.
No global state, no hidden dependencies. FastAPI handles the wiring.

### Pattern 4: Repository (via SQLAlchemy models)

All database access goes through SQLAlchemy model classes defined in `models/db.py`.
Route handlers never write raw SQL. They use:
```python
db.query(Trade).filter(Trade.status == "open").all()
db.add(new_trade)
db.commit()
```

**Why?** If you switch from PostgreSQL to MySQL tomorrow, only `core/database.py` changes.
Every route stays the same.

### Pattern 5: Adapter / Fallback

`market/adapter.py` is the single decision point: use Fyers or use simulator?

```python
def get_quote(symbol: str) -> Quote:
    if is_live_mode() and cache.has_fresh_data(symbol):
        return cache.get(symbol)      # live data from Fyers WS
    return simulator.get_quote(symbol)  # Black-Scholes fallback
```

**Why?** Every route calls `adapter.get_quote()`. None of them know or care
whether the data came from Fyers or the simulator. You can swap the data source
without touching any route.

### Pattern 6: Observer / Pub-Sub (WebSocket broadcast)

When a Fyers tick arrives:
1. `fyers/websocket.py` updates the price cache (publisher)
2. `routes/ws.py` has a set of connected WebSocket clients (subscribers)
3. The background task loops: reads cache → broadcasts to all subscribers

```
Fyers tick → cache.update() → broadcast loop → all connected browsers
```

**Why?** Publishers (Fyers) and subscribers (browser tabs) are completely decoupled.
Fyers doesn't know browsers exist. Browsers don't know Fyers exists. The cache is the bus.

---

## 6. Project structure — how to read the code

```
artifacts/python-api/
│
├── main.py                   ← START HERE. 40 lines. Boots everything.
├── requirements.txt          ← pip dependencies
├── .env.example              ← copy to .env, fill credentials
│
├── core/                     ← infrastructure (boring but essential)
│   ├── config.py             ← reads .env, exposes Settings object
│   ├── database.py           ← creates PostgreSQL connection pool
│   └── logger.py             ← structured JSON logging setup
│
├── fyers/                    ← everything Fyers-specific
│   ├── symbols.py            ← NIFTY → NSE:NIFTY50-INDEX mappings
│   ├── client.py             ← Fyers REST SDK (quotes, option chain)
│   └── websocket.py          ← Fyers WebSocket client (live ticks)
│
├── market/                   ← market data logic
│   ├── cache.py              ← in-memory price cache (updated by WS)
│   ├── simulator.py          ← Black-Scholes pricing (fallback)
│   └── adapter.py            ← live vs simulator switch
│
├── models/                   ← data shapes
│   ├── db.py                 ← SQLAlchemy table definitions (what DB looks like)
│   └── schemas.py            ← Pydantic models (what API looks like)
│
├── services/                 ← business logic
│   ├── pnl.py                ← P&L calculation engine
│   └── seed_strategies.py    ← inserts 6 preset strategies on first boot
│
└── routes/                   ← HTTP endpoints (what the frontend calls)
    ├── market.py             ← /api/market/*
    ├── trades.py             ← /api/trades/*
    ← /api/strategies/*
    ├── dashboard.py          ← /api/dashboard/*
    └── ws.py                 ← /ws (WebSocket, price stream)
```

**Reading order for understanding the full flow:**
1. `main.py` — how the app starts
2. `core/config.py` — what environment variables are needed
3. `core/database.py` — how we connect to PostgreSQL
4. `fyers/client.py` — how we call Fyers REST API
5. `fyers/websocket.py` — how we receive live ticks
6. `market/cache.py` — how prices are stored in memory
7. `market/adapter.py` — how live/simulator decision is made
8. `routes/market.py` — how the frontend gets market data
9. `routes/ws.py` — how the frontend receives live price stream
10. `models/db.py` + `models/schemas.py` — what data looks like

---

## 7. FastAPI concepts explained for beginners

### What is a route decorator?

```python
@router.get("/market/quote")   # ← This is a decorator
async def get_quote(symbol: str):
    return {"ltp": 24176}
```

The `@router.get("/market/quote")` line tells FastAPI: "When a GET request arrives
at `/market/quote`, run the function below it." The function's return value becomes
the JSON response automatically.

### What is `async def`?

```python
async def get_quote(symbol: str):   # async version
def get_quote(symbol: str):         # sync version
```

Use `async def` when your function waits for something (database, network call).
While it waits, FastAPI can handle other requests. Use `def` (without async) when
your function is pure computation with no waiting. Both work correctly in FastAPI.

### What is `Depends()`?

```python
def get_db():
    db = SessionLocal()   # open DB connection
    try:
        yield db          # give it to the route
    finally:
        db.close()        # close it after request finishes

@router.get("/trades")
def list_trades(db: Session = Depends(get_db)):
    #                       ↑ FastAPI calls get_db(), passes result as `db`
    return db.query(Trade).all()
```

`Depends(get_db)` means: "Before running `list_trades`, call `get_db()` and inject
the result." FastAPI handles opening and closing the DB session for you.

### What is a Pydantic model?

```python
from pydantic import BaseModel

class QuoteResponse(BaseModel):
    symbol: str
    ltp: float
    change: float
    timestamp: str
```

This is a Python class that describes the shape of data. FastAPI uses it to:
1. Automatically validate incoming request bodies
2. Automatically serialize response data to JSON
3. Automatically generate documentation at `/docs`

It is the Python equivalent of a TypeScript interface + Zod schema combined.

### What is `yield` in a dependency?

```python
def get_db():
    db = SessionLocal()
    try:
        yield db       # ← code PAUSES here, route runs, then resumes below
    finally:
        db.close()     # ← always runs, even if route threw an error
```

`yield` turns the function into a generator. FastAPI runs the code before `yield`,
gives the yielded value to the route, runs the route, then resumes after `yield`.
This guarantees the DB connection is always closed, even if there is an exception.

---

## 8. Running locally — step by step

### Prerequisites
- Python 3.11 or newer (`python --version`)
- PostgreSQL running (same DB as the Node.js backend — no migration needed)

### Step 1: Install dependencies
```bash
cd artifacts/python-api
pip install -r requirements.txt
```

### Step 2: Configure environment
```bash
cp .env.example .env
# Edit .env and fill in your values
```

Your `.env` file:
```
DATABASE_URL=postgresql://user:password@localhost:5432/options_trader
FYERS_APP_ID=QWOKW94G0J-100
FYERS_ACCESS_TOKEN=your_daily_token_here
PORT=8000
```

### Step 3: Run the server
```bash
python main.py
```

Or with auto-reload during development:
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Step 4: Verify it works
- API explorer: http://localhost:8000/docs
- Health check: http://localhost:8000/api/healthz
- Market mode: http://localhost:8000/api/market/mode

### Step 5: Stop the Node.js server
Once the Python server is running correctly, stop the Node.js API server.
The frontend will automatically use the Python server since both serve `/api`.

---

## 9. Environment variables reference

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `FYERS_APP_ID` | No | Your Fyers app ID (enables live mode) |
| `FYERS_ACCESS_TOKEN` | No | Daily access token from Fyers |
| `PORT` | No | Server port (default: 8000) |

**Token refresh:** Fyers tokens expire at midnight every day.
Each morning, log into your Fyers dashboard, generate a new token,
and update `FYERS_ACCESS_TOKEN` in your `.env`, then restart the server.

---

## 10. How the Fyers connection works

The official Fyers Python SDK handles all the complexity:

```python
from fyers_apiv3 import fyersModel

# REST calls (option chain, historical data)
fyers = fyersModel.FyersModel(
    token=f"{app_id}:{access_token}",
    client_id=app_id,
    is_async=False
)
response = fyers.quotes({"symbols": "NSE:NIFTY50-INDEX"})
# response = {"s": "ok", "d": [{"n": "NSE:NIFTY50-INDEX", "v": {"lp": 24176, ...}}]}
```

The SDK handles:
- Auth header construction
- JSON serialization
- Basic error handling
- Rate limit responses

**Important:** Fyers blocks requests from cloud datacenter IPs (Cloudflare 1015).
This server must run on your local machine (home/office IP) to receive live data.
On Replit cloud, it automatically falls back to the Black-Scholes simulator.

---

## 11. How the WebSocket feed works

```
Startup sequence:
  1. main.py starts FastAPI
  2. On startup event: FyersWebSocketClient starts in background thread
  3. Client connects to wss://socket.fyers.in/trade/v3/
  4. Subscribes to: NSE:NIFTY50-INDEX, NSE:NIFTYBANK-INDEX, NSE:FINNIFTY-INDEX
  5. On each tick: cache.update(symbol, {ltp, open, high, low, ...})

Browser connects:
  1. Frontend opens WebSocket to ws://localhost:8000/ws
  2. Server adds client to connected_clients set
  3. Background loop reads cache every second, broadcasts to all clients
  4. Frontend receives JSON: {"type": "quote", "symbol": "NIFTY", "ltp": 24176, ...}
  5. On disconnect: client removed from set automatically
```

The Fyers WebSocket runs in a separate thread because the Fyers SDK uses blocking
I/O. FastAPI's WebSocket endpoint is async. The two communicate through the shared
price cache — no direct connection between them.

---

## 12. The in-memory price cache

`market/cache.py` is the heart of the real-time system.

```
Thread 1 (Fyers WS): writes to cache on every tick
Thread 2 (FastAPI):  reads from cache on every request
```

The cache uses a `threading.Lock` to prevent race conditions — if both threads
try to access the dict simultaneously, the lock ensures they take turns.

Cache contents:
```python
{
    "NIFTY": {
        "ltp": 24176, "open": 24050, "high": 24220, "low": 23980,
        "change": 126, "change_pct": 0.52, "vix": 13.8,
        "updated_at": "2026-05-13T09:45:23"
    },
    "BANKNIFTY": { ... },
    "FINNIFTY": { ... }
}
```

Cache freshness: if a price has not been updated in 60 seconds (e.g., market closed,
connection dropped), the adapter falls back to the simulator automatically.

---

## 13. The simulator fallback

When Fyers is unavailable (market closed, IP blocked, token expired), the
Black-Scholes simulator generates realistic prices.

The simulator uses:
- Seed-based random: same seed = same price within a 5-minute window (prices don't
  jump erratically on every refresh)
- Daily movement: a seed based on today's date produces consistent daily drift
- Black-Scholes formula: industry-standard options pricing model
- Real lot sizes: NIFTY=75, BANKNIFTY=15, FINNIFTY=65, SENSEX=10

The simulator produces the same interface as live data. Routes never know which
they received — they just call `adapter.get_quote(symbol)` and get a quote back.

---

## 14. Database schema

Same PostgreSQL schema as the original Node.js backend. No migration needed.

| Table | Purpose |
|---|---|
| `trades` | Each paper trade (one Iron Condor = one row) |
| `trade_legs` | Individual option legs (one IC = 4 rows) |
| `strategies` | Preset strategy configurations |
| `activity_events` | Audit log (trade opened, trade closed, etc.) |
| `daily_pnl` | Daily P&L ledger for reporting |

SQLAlchemy models in `models/db.py` mirror this schema exactly.

---

## 15. API endpoints reference

All endpoints are also documented interactively at `http://localhost:8000/docs`.

### Market
| Method | Path | Description |
|---|---|---|
| GET | `/api/healthz` | Health check |
| GET | `/api/market/mode` | Live/blocked/simulator status |
| GET | `/api/market/quote?symbol=NIFTY` | Single index quote |
| GET | `/api/market/option-chain?symbol=NIFTY&expiry=14MAY26` | Full option chain |
| GET | `/api/market/expiries?symbol=NIFTY` | Available expiry dates |
| WS | `/ws` | WebSocket: real-time price stream |

### Trades
| Method | Path | Description |
|---|---|---|
| GET | `/api/trades` | List all trades (filter: ?status=open\|closed) |
| POST | `/api/trades` | Create a new trade |
| GET | `/api/trades/:id` | Get single trade with legs |
| PATCH | `/api/trades/:id` | Update trade fields |
| DELETE | `/api/trades/:id` | Delete trade |
| POST | `/api/trades/:id/close` | Close trade, calculate realized P&L |
| POST | `/api/trades/refresh-pnl` | Refresh unrealized P&L for all open trades |

### Strategies
| Method | Path | Description |
|---|---|---|
| GET | `/api/strategies` | List all strategies |
| POST | `/api/strategies` | Create strategy |
| PATCH | `/api/strategies/:id` | Update strategy |
| DELETE | `/api/strategies/:id` | Delete strategy |
| POST | `/api/strategies/:id/execute` | Execute strategy now |
| POST | `/api/strategies/:id/toggle` | Toggle auto-execution on/off |

### Dashboard
| Method | Path | Description |
|---|---|---|
| GET | `/api/dashboard/summary` | Portfolio overview (P&L, win rate, etc.) |
| GET | `/api/dashboard/pnl-chart` | 30-day daily P&L for chart |
| GET | `/api/dashboard/strategy-breakdown` | P&L by strategy type |
| GET | `/api/dashboard/recent-activity` | Last 10 activity events |
| GET | `/api/dashboard/daily-pnl` | Full daily P&L ledger |
| GET | `/api/dashboard/capital-summary` | Capital deployed by underlying |

---

## 16. Extending this project

The architecture is designed for extension. Here is where each new feature goes:

| Feature to add | Where to add it |
|---|---|
| New strategy type | `services/seed_strategies.py` + `routes/strategies.py` |
| New market data field | `market/cache.py` + `models/schemas.py` |
| Real order placement | New `fyers/orders.py` + new `routes/orders.py` |
| Stop-loss auto-exit | New `services/risk_manager.py` + hook into WS tick handler |
| Telegram alerts | New `services/notifications.py` + call from risk_manager |
| More underlyings | `fyers/symbols.py` + `market/simulator.py` BASE_PRICES |
| Historical data | `fyers/client.py` new method + new `routes/history.py` |

Each feature is isolated. Adding one does not require touching others.
