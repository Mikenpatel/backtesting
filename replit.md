# Workspace

## Overview

pnpm workspace monorepo — Indian Options Paper Trading Dashboard for NSE (NIFTY, BANKNIFTY, FINNIFTY).

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Python FastAPI (port 8000) — replaces the old Express 5 backend
- **Database**: PostgreSQL + SQLAlchemy (Python) / Drizzle ORM schema still used for reference
- **Validation**: Pydantic v2 (Python) — runtime schema validation
- **Frontend**: React + Vite + Tailwind CSS v4 + Recharts
- **Market data**: Fyers WebSocket (live) or Black-Scholes simulator (fallback)

## Application: Indian Options Paper Trader

A paper trading dashboard for learning Indian NSE options strategies:
- **Iron Condor** (Weekly, Biweekly, Monthly)
- **Calendar Spread**
- **Intraday Expiry** (Short Straddle on expiry day)

### Features
- Auto-strategy execution (execute now or toggle auto-mode)
- Full option chain with Black-Scholes pricing (simulated or live via Fyers)
- Trade tracking with unrealized/realized P&L
- Daily P&L chart, strategy breakdown analytics
- Recent activity feed
- Market quotes: NIFTY, BANKNIFTY, FINNIFTY, SENSEX, India VIX
- Real-time WebSocket price streaming (when Fyers token is set)

### Market Data Modes
- **LIVE**: Fyers WebSocket connected, real-time ticks
- **IP BLOCKED**: Fyers credentials set but IP/token invalid — simulator takes over
- **SIMULATOR**: No credentials — Black-Scholes pricing with seed-based daily movement

### Lot Sizes
- NIFTY=75, BANKNIFTY=15, FINNIFTY=65, SENSEX=10

## Running the Project

### On Replit (normal use)

Two workflows start automatically when the Repl opens. No manual commands needed.

| Workflow | Command | Port | URL path |
|---|---|---|---|
| `artifacts/api-server: Python API Server` | `python artifacts/python-api/main.py` | 8000 | `/api`, `/ws` |
| `artifacts/options-dashboard: web` | `pnpm --filter @workspace/options-dashboard run dev` | 25612 | `/` |

A reverse proxy sits in front of both. All browser traffic goes to `localhost:80`:
- `localhost:80/` → Vite dev server (frontend)
- `localhost:80/api/*` → FastAPI (backend REST)
- `localhost:80/ws` → FastAPI (WebSocket price stream)

To restart a workflow after a code change, use the workflow panel in the Replit sidebar
or run the relevant workflow command manually from the shell.

### First-time setup (fresh clone or new environment)

**1. Install Node dependencies** (frontend + codegen tooling):
```bash
pnpm install
```

**2. Install Python dependencies** (backend):
```bash
pip install -r artifacts/python-api/requirements.txt
```

**3. Create the backend `.env` file**:
```bash
cp artifacts/python-api/.env.example artifacts/python-api/.env
```
Then edit `artifacts/python-api/.env` and fill in:
```
DATABASE_URL=postgresql://user:password@host/dbname
FYERS_APP_ID=           # optional — leave blank to use simulator
FYERS_ACCESS_TOKEN=     # optional — leave blank to use simulator
PORT=8000
```
On Replit the `DATABASE_URL` is already set via the environment. Check with:
```bash
echo $DATABASE_URL
```

**4. Push the database schema** (first time or after schema changes):
```bash
pnpm --filter @workspace/db run push
```

**5. Start both workflows** from the Replit sidebar, then open the preview pane.
The dashboard loads at `/`. The Market page shows the current data mode badge
(LIVE, IP BLOCKED, or SIMULATOR) in the top-right corner.

### Verify everything is running

```bash
curl localhost:80/api/healthz          # → {"status":"ok"}
curl localhost:80/api/market/mode      # → {"mode":"blocked"|"live"|"simulator",...}
curl localhost:80/api/strategies       # → [...6 seeded strategies...]
```

### After changing Python code

Restart the `artifacts/api-server: Python API Server` workflow.
The server has no hot-reload in production mode — a restart is always required.

### After changing frontend code

Vite hot-reloads automatically. No restart needed unless you change `vite.config.ts`
or add/remove npm packages (in which case run `pnpm install` then restart the workflow).

### After changing the OpenAPI spec (`lib/api-spec/openapi.yaml`)

Regenerate the React Query hooks and Zod schemas used by the frontend:
```bash
pnpm --filter @workspace/api-spec run codegen
```
Then typecheck to confirm nothing is broken:
```bash
pnpm run typecheck
```

---

## Daily Fyers Token Refresh

Fyers access tokens expire every 24 hours. To refresh:
1. Log in to Fyers → API section → generate a new access token
2. Edit `artifacts/python-api/.env` — update `FYERS_ACCESS_TOKEN=<new_token>`
3. Restart the `artifacts/api-server: Python API Server` workflow

The `.env` file is at `artifacts/python-api/.env`. Never commit it — it contains credentials.

---

## Key Commands

- `pnpm install` — install all Node.js dependencies
- `pip install -r artifacts/python-api/requirements.txt` — install Python dependencies
- `pnpm run typecheck` — full typecheck across TypeScript packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)

## Structure

- `artifacts/python-api/` — **Active Python FastAPI backend** (port 8000)
  - `main.py` — entry point, lifespan, route registration
  - `core/` — config, database, logging, camelCase JSON response
  - `fyers/` — Fyers WebSocket client, symbol mappings
  - `market/` — price cache, simulator, adapter (live→simulator fallback)
  - `models/` — Pydantic schemas + SQLAlchemy DB models
  - `routes/` — market, trades, strategies, dashboard, WebSocket
  - `services/` — P&L computation, strategy seeding
  - `README.md` — full architecture + beginner FastAPI guide
- `artifacts/api-server/` — Old Node.js server (retired; artifact.toml now points to Python)
- `artifacts/options-dashboard/` — React+Vite frontend (dark theme)
  - `src/pages/Dashboard.tsx` — main portfolio overview
  - `src/pages/Trades.tsx` — trade list with expandable legs
  - `src/pages/Strategies.tsx` — strategy management
  - `src/pages/Market.tsx` — market data and option chain
  - `src/pages/PnlStatement.tsx` — full P&L ledger
- `lib/db/src/schema/` — Drizzle ORM schema (PostgreSQL schema reference)
- `lib/api-spec/openapi.yaml` — OpenAPI contract (frontend hooks generated from this)

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
See `artifacts/python-api/README.md` for full Python backend documentation.
