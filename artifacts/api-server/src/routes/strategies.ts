import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, strategiesTable, tradesTable, tradeLegsTable, activityEventsTable } from "@workspace/db";
import {
  CreateStrategyBody,
  UpdateStrategyBody,
  GetStrategyParams,
  UpdateStrategyParams,
  DeleteStrategyParams,
  ExecuteStrategyParams,
  ToggleStrategyParams,
} from "@workspace/api-zod";
import { getLtp, getExpiries, buildIronCondorLegs, buildCalendarSpreadLegs, buildIntradayExpiryLegs } from "../lib/market-simulator";

const router: IRouter = Router();

function formatStrategy(s: typeof strategiesTable.$inferSelect) {
  return {
    id: s.id,
    name: s.name,
    strategyType: s.strategyType,
    underlying: s.underlying,
    frequency: s.frequency,
    isActive: s.isActive,
    lotMultiplier: s.lotMultiplier,
    deltaTarget: s.deltaTarget != null ? Number(s.deltaTarget) : null,
    wingWidth: s.wingWidth ?? null,
    stopLossPct: s.stopLossPct != null ? Number(s.stopLossPct) : null,
    targetProfitPct: s.targetProfitPct != null ? Number(s.targetProfitPct) : null,
    entryTimeIst: s.entryTimeIst ?? null,
    exitTimeIst: s.exitTimeIst ?? null,
    lastExecutedAt: s.lastExecutedAt?.toISOString() ?? null,
    totalTradesPlaced: s.totalTradesPlaced,
    totalPnl: Number(s.totalPnl),
    createdAt: s.createdAt.toISOString(),
  };
}

router.get("/strategies", async (_req, res): Promise<void> => {
  const strategies = await db.select().from(strategiesTable).orderBy(desc(strategiesTable.createdAt));
  res.json(strategies.map(formatStrategy));
});

router.post("/strategies", async (req, res): Promise<void> => {
  const parsed = CreateStrategyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [strategy] = await db
    .insert(strategiesTable)
    .values({
      ...parsed.data,
      deltaTarget: parsed.data.deltaTarget != null ? String(parsed.data.deltaTarget) : null,
      stopLossPct: parsed.data.stopLossPct != null ? String(parsed.data.stopLossPct) : null,
      targetProfitPct: parsed.data.targetProfitPct != null ? String(parsed.data.targetProfitPct) : null,
    })
    .returning();

  res.status(201).json(formatStrategy(strategy));
});

router.get("/strategies/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [strategy] = await db.select().from(strategiesTable).where(eq(strategiesTable.id, id));
  if (!strategy) { res.status(404).json({ error: "Strategy not found" }); return; }

  res.json(formatStrategy(strategy));
});

router.patch("/strategies/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdateStrategyBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const updateData: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.deltaTarget != null) updateData.deltaTarget = String(parsed.data.deltaTarget);
  if (parsed.data.stopLossPct != null) updateData.stopLossPct = String(parsed.data.stopLossPct);
  if (parsed.data.targetProfitPct != null) updateData.targetProfitPct = String(parsed.data.targetProfitPct);

  const [updated] = await db.update(strategiesTable).set(updateData).where(eq(strategiesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Strategy not found" }); return; }

  res.json(formatStrategy(updated));
});

router.delete("/strategies/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [deleted] = await db.delete(strategiesTable).where(eq(strategiesTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Strategy not found" }); return; }

  res.sendStatus(204);
});

router.post("/strategies/:id/execute", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [strategy] = await db.select().from(strategiesTable).where(eq(strategiesTable.id, id));
  if (!strategy) { res.status(404).json({ error: "Strategy not found" }); return; }

  const expiries = getExpiries(strategy.underlying);
  const nearExpiry = expiries[0];
  const farExpiry = expiries[2] ?? expiries[1];

  let legs: ReturnType<typeof buildIronCondorLegs>["legs"];
  let maxProfit: number | null;
  let maxLoss: number | null;

  if (strategy.strategyType === "IRON_CONDOR") {
    const wingWidth = strategy.wingWidth ?? 200;
    const result = buildIronCondorLegs(strategy.underlying, nearExpiry, wingWidth);
    legs = result.legs;
    maxProfit = result.maxProfit;
    maxLoss = result.maxLoss;
  } else if (strategy.strategyType === "CALENDAR_SPREAD") {
    const result = buildCalendarSpreadLegs(strategy.underlying, nearExpiry, farExpiry);
    legs = result.legs;
    maxProfit = result.maxProfit;
    maxLoss = result.maxLoss;
  } else {
    const result = buildIntradayExpiryLegs(strategy.underlying, nearExpiry);
    legs = result.legs;
    maxProfit = result.maxProfit;
    maxLoss = result.maxLoss;
  }

  const ltp = getLtp(strategy.underlying);
  const freq = strategy.frequency === "INTRADAY" ? null : strategy.frequency as "WEEKLY" | "BIWEEKLY" | "MONTHLY";

  const [trade] = await db
    .insert(tradesTable)
    .values({
      strategyType: strategy.strategyType,
      strategyFrequency: freq,
      underlying: strategy.underlying,
      status: "open",
      entryUnderlyingPrice: String(ltp),
      unrealizedPnl: "0",
      maxProfit: maxProfit != null ? String(maxProfit) : null,
      maxLoss: maxLoss != null ? String(maxLoss) : null,
      strategyId: strategy.id,
    })
    .returning();

  const multiplier = strategy.lotMultiplier;
  const insertedLegs = await db
    .insert(tradeLegsTable)
    .values(
      legs.map((l) => ({
        tradeId: trade.id,
        symbol: l.symbol,
        optionType: l.optionType,
        strike: String(l.strike),
        expiry: l.expiry,
        action: l.action,
        quantity: multiplier,
        entryPrice: String(l.entryPrice),
        currentPrice: String(l.currentPrice),
        lotSize: l.lotSize,
      })),
    )
    .returning();

  await db.update(strategiesTable).set({
    lastExecutedAt: new Date(),
    totalTradesPlaced: strategy.totalTradesPlaced + 1,
  }).where(eq(strategiesTable.id, id));

  await db.insert(activityEventsTable).values({
    type: "strategy_executed",
    tradeId: trade.id,
    strategyId: strategy.id,
    message: `${strategy.name} executed: ${strategy.strategyType} on ${strategy.underlying}`,
    timestamp: new Date(),
  });

  const formattedLegs = insertedLegs.map((leg) => ({
    id: leg.id,
    tradeId: leg.tradeId,
    symbol: leg.symbol,
    optionType: leg.optionType,
    strike: Number(leg.strike),
    expiry: leg.expiry,
    action: leg.action,
    quantity: leg.quantity,
    entryPrice: Number(leg.entryPrice),
    exitPrice: null,
    currentPrice: Number(leg.currentPrice),
    lotSize: leg.lotSize,
    createdAt: leg.createdAt.toISOString(),
  }));

  res.status(201).json({
    id: trade.id,
    strategyType: trade.strategyType,
    strategyFrequency: trade.strategyFrequency ?? null,
    underlying: trade.underlying,
    status: trade.status,
    entryTime: trade.entryTime.toISOString(),
    exitTime: null,
    entryUnderlyingPrice: Number(trade.entryUnderlyingPrice),
    exitUnderlyingPrice: null,
    unrealizedPnl: 0,
    realizedPnl: null,
    maxProfit: maxProfit,
    maxLoss: maxLoss,
    notes: null,
    legs: formattedLegs,
    createdAt: trade.createdAt.toISOString(),
    updatedAt: trade.updatedAt.toISOString(),
  });
});

router.post("/strategies/:id/toggle", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [strategy] = await db.select().from(strategiesTable).where(eq(strategiesTable.id, id));
  if (!strategy) { res.status(404).json({ error: "Strategy not found" }); return; }

  const [updated] = await db
    .update(strategiesTable)
    .set({ isActive: !strategy.isActive })
    .where(eq(strategiesTable.id, id))
    .returning();

  res.json(formatStrategy(updated!));
});

export default router;
