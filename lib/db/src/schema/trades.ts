import { pgTable, serial, text, numeric, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const UNDERLYINGS = ["NIFTY", "BANKNIFTY", "FINNIFTY", "SENSEX"] as const;
export const STRATEGY_TYPES = ["IRON_CONDOR", "CALENDAR_SPREAD", "INTRADAY_EXPIRY", "INTRADAY_IC", "MANUAL"] as const;
export const STRATEGY_FREQUENCIES = ["WEEKLY", "BIWEEKLY", "MONTHLY", "INTRADAY"] as const;

export const tradesTable = pgTable("trades", {
  id: serial("id").primaryKey(),
  strategyType: text("strategy_type", { enum: STRATEGY_TYPES }).notNull(),
  strategyFrequency: text("strategy_frequency", { enum: STRATEGY_FREQUENCIES }),
  underlying: text("underlying", { enum: UNDERLYINGS }).notNull(),
  status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
  entryTime: timestamp("entry_time", { withTimezone: true }).notNull().defaultNow(),
  exitTime: timestamp("exit_time", { withTimezone: true }),
  entryUnderlyingPrice: numeric("entry_underlying_price", { precision: 10, scale: 2 }).notNull(),
  exitUnderlyingPrice: numeric("exit_underlying_price", { precision: 10, scale: 2 }),
  unrealizedPnl: numeric("unrealized_pnl", { precision: 12, scale: 2 }).notNull().default("0"),
  realizedPnl: numeric("realized_pnl", { precision: 12, scale: 2 }),
  maxProfit: numeric("max_profit", { precision: 12, scale: 2 }),
  maxLoss: numeric("max_loss", { precision: 12, scale: 2 }),
  netPremium: numeric("net_premium", { precision: 10, scale: 2 }),
  capitalDeployed: numeric("capital_deployed", { precision: 12, scale: 2 }),
  returnPct: numeric("return_pct", { precision: 8, scale: 4 }),
  notes: text("notes"),
  strategyId: integer("strategy_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const tradeLegsTable = pgTable("trade_legs", {
  id: serial("id").primaryKey(),
  tradeId: integer("trade_id").notNull(),
  symbol: text("symbol").notNull(),
  optionType: text("option_type", { enum: ["CE", "PE"] }).notNull(),
  strike: numeric("strike", { precision: 10, scale: 2 }).notNull(),
  expiry: text("expiry").notNull(),
  action: text("action", { enum: ["BUY", "SELL"] }).notNull(),
  quantity: integer("quantity").notNull(),
  entryPrice: numeric("entry_price", { precision: 10, scale: 2 }).notNull(),
  exitPrice: numeric("exit_price", { precision: 10, scale: 2 }),
  currentPrice: numeric("current_price", { precision: 10, scale: 2 }).notNull(),
  lotSize: integer("lot_size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const activityEventsTable = pgTable("activity_events", {
  id: serial("id").primaryKey(),
  type: text("type", { enum: ["trade_opened", "trade_closed", "strategy_executed", "pnl_updated"] }).notNull(),
  tradeId: integer("trade_id"),
  strategyId: integer("strategy_id"),
  message: text("message").notNull(),
  pnl: numeric("pnl", { precision: 12, scale: 2 }),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
});

export const dailyPnlTable = pgTable("daily_pnl", {
  id: serial("id").primaryKey(),
  date: text("date").notNull(),
  underlying: text("underlying", { enum: UNDERLYINGS }).notNull(),
  strategyType: text("strategy_type", { enum: STRATEGY_TYPES }).notNull(),
  strategyFrequency: text("strategy_frequency", { enum: STRATEGY_FREQUENCIES }),
  tradeId: integer("trade_id"),
  netPremium: numeric("net_premium", { precision: 10, scale: 2 }).notNull().default("0"),
  realizedPnl: numeric("realized_pnl", { precision: 12, scale: 2 }).notNull().default("0"),
  capitalDeployed: numeric("capital_deployed", { precision: 12, scale: 2 }).notNull().default("0"),
  returnPct: numeric("return_pct", { precision: 8, scale: 4 }).notNull().default("0"),
  brokerageCost: numeric("brokerage_cost", { precision: 10, scale: 2 }).notNull().default("300"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTradeSchema = createInsertSchema(tradesTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertTradeLegSchema = createInsertSchema(tradeLegsTable).omit({ id: true, createdAt: true });
export const insertActivityEventSchema = createInsertSchema(activityEventsTable).omit({ id: true });
export const insertDailyPnlSchema = createInsertSchema(dailyPnlTable).omit({ id: true, createdAt: true });

export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof tradesTable.$inferSelect;
export type TradeLeg = typeof tradeLegsTable.$inferSelect;
export type InsertActivityEvent = z.infer<typeof insertActivityEventSchema>;
export type DailyPnl = typeof dailyPnlTable.$inferSelect;
