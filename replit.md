# Workspace

## Overview

pnpm workspace monorepo — Indian Options Paper Trading Dashboard for NSE (NIFTY, BANKNIFTY, FINNIFTY).

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind CSS v4 + Recharts

## Application: Indian Options Paper Trader

A paper trading dashboard for learning Indian NSE options strategies:
- **Iron Condor** (Weekly, Biweekly, Monthly)
- **Calendar Spread**
- **Intraday Expiry** (Short Straddle on expiry day)

### Features
- Auto-strategy execution (execute now or toggle auto-mode)
- Full option chain with Black-Scholes pricing (simulated, not live)
- Trade tracking with unrealized/realized P&L
- Daily P&L chart, strategy breakdown analytics
- Recent activity feed
- Market quotes: NIFTY, BANKNIFTY, FINNIFTY, India VIX

### Market Simulation
- `artifacts/api-server/src/lib/market-simulator.ts` — Black-Scholes pricing engine
- Prices move realistically using seed-based random with daily and intraday movement
- Lot sizes: NIFTY=25, BANKNIFTY=15, FINNIFTY=40

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Structure

- `artifacts/api-server/` — Express 5 API server
  - `src/routes/market.ts` — market quotes and option chain
  - `src/routes/trades.ts` — trade CRUD and P&L management
  - `src/routes/strategies.ts` — strategy management and execution
  - `src/routes/dashboard.ts` — portfolio analytics
  - `src/lib/market-simulator.ts` — Black-Scholes pricing engine
- `artifacts/options-dashboard/` — React+Vite frontend (dark theme)
  - `src/pages/Dashboard.tsx` — main portfolio overview
  - `src/pages/Trades.tsx` — trade list with expandable legs
  - `src/pages/Strategies.tsx` — strategy management
  - `src/pages/Market.tsx` — market data and option chain
  - `src/pages/NewTrade.tsx` — manual trade entry form
- `lib/db/src/schema/` — Drizzle ORM schema (trades, strategies, activity)
- `lib/api-spec/openapi.yaml` — OpenAPI contract

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
