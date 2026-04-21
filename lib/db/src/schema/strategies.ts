import { pgTable, serial, text, boolean, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { UNDERLYINGS, STRATEGY_TYPES, STRATEGY_FREQUENCIES } from "./trades";

export const strategiesTable = pgTable("strategies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  strategyType: text("strategy_type", { enum: STRATEGY_TYPES }).notNull(),
  underlying: text("underlying", { enum: UNDERLYINGS }).notNull(),
  frequency: text("frequency", { enum: STRATEGY_FREQUENCIES }).notNull(),
  isActive: boolean("is_active").notNull().default(false),
  lotMultiplier: integer("lot_multiplier").notNull().default(1),
  deltaTarget: numeric("delta_target", { precision: 5, scale: 2 }),
  wingWidth: integer("wing_width"),
  stopLossPct: numeric("stop_loss_pct", { precision: 5, scale: 2 }),
  targetProfitPct: numeric("target_profit_pct", { precision: 5, scale: 2 }),
  capitalPerTrade: numeric("capital_per_trade", { precision: 12, scale: 2 }).default("90000"),
  maxBuyingLegPremium: numeric("max_buying_leg_premium", { precision: 6, scale: 2 }).default("5"),
  targetReturnPct: numeric("target_return_pct", { precision: 5, scale: 2 }).default("1"),
  brokerageCost: numeric("brokerage_cost", { precision: 8, scale: 2 }).default("300"),
  entryTimeIst: text("entry_time_ist"),
  exitTimeIst: text("exit_time_ist"),
  lastExecutedAt: timestamp("last_executed_at", { withTimezone: true }),
  totalTradesPlaced: integer("total_trades_placed").notNull().default(0),
  totalPnl: numeric("total_pnl", { precision: 12, scale: 2 }).notNull().default("0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertStrategySchema = createInsertSchema(strategiesTable).omit({
  id: true, createdAt: true, updatedAt: true, lastExecutedAt: true, totalTradesPlaced: true, totalPnl: true,
});
export type InsertStrategy = z.infer<typeof insertStrategySchema>;
export type Strategy = typeof strategiesTable.$inferSelect;
