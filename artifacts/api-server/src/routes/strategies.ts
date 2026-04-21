import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, strategiesTable, tradesTable, tradeLegsTable, activityEventsTable, dailyPnlTable } from "@workspace/db";
import {
  CreateStrategyBody,
  UpdateStrategyBody,
  ExecuteStrategyParams,
  ToggleStrategyParams,
  DeleteStrategyParams,
} from "@workspace/api-zod";
import { getQuote, getExpiries, findIronCondorLegs, findIntradayIcLegs, getLotSize } from "../lib/market-adapter";

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
    capitalPerTrade: s.capitalPerTrade != null ? Number(s.capitalPerTrade) : 90000,
    maxBuyingLegPremium: s.maxBuyingLegPremium != null ? Number(s.maxBuyingLegPremium) : 5,
    targetReturnPct: s.targetReturnPct != null ? Number(s.targetReturnPct) : 1,
    brokerageCost: s.brokerageCost != null ? Number(s.brokerageCost) : 300,
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
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

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

router.patch("/strategies/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
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
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [deleted] = await db.delete(strategiesTable).where(eq(strategiesTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Strategy not found" }); return; }

  res.sendStatus(204);
});

router.post("/strategies/:id/execute", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [strategy] = await db.select().from(strategiesTable).where(eq(strategiesTable.id, id));
  if (!strategy) { res.status(404).json({ error: "Strategy not found" }); return; }

  const expiries = await getExpiries(strategy.underlying);
  const nearExpiry = expiries[0];
  const biweeklyExpiry = expiries[1] ?? expiries[0];
  const monthlyExpiry = expiries.find((e, i) => i >= 2) ?? expiries[expiries.length - 1];

  const freq = strategy.frequency;
  const targetExpiry = freq === "BIWEEKLY" ? biweeklyExpiry
    : freq === "MONTHLY" ? monthlyExpiry
    : nearExpiry;

  const capitalPerTrade = Number(strategy.capitalPerTrade ?? 90000);
  const targetReturnPct = Number(strategy.targetReturnPct ?? 1);
  const brokerageCost = Number(strategy.brokerageCost ?? 300);
  const maxBuyingLegPremium = Number(strategy.maxBuyingLegPremium ?? 5);
  const wingWidth = strategy.wingWidth ?? 200;

  let legs: Array<{ symbol: string; optionType: "CE" | "PE"; strike: number; expiry: string; action: "BUY" | "SELL"; quantity: number; entryPrice: number; currentPrice: number; lotSize: number }>;
  let maxProfit: number | null = null;
  let maxLoss: number | null = null;
  let netPremium = 0;

  if (strategy.strategyType === "INTRADAY_IC" || strategy.frequency === "INTRADAY") {
    const result = await findIntradayIcLegs(
      strategy.underlying, targetExpiry, capitalPerTrade, targetReturnPct, brokerageCost, maxBuyingLegPremium,
    );
    legs = result.legs;
    netPremium = result.netCredit;
    maxProfit = result.maxProfit;
  } else {
    const result = await findIronCondorLegs(strategy.underlying, targetExpiry, wingWidth, strategy.lotMultiplier);
    legs = result.legs;
    netPremium = result.netCredit;
    maxProfit = result.maxProfit;
    maxLoss = result.maxLoss;
  }

  const quote = await getQuote(strategy.underlying);
  const ltp = quote.ltp;
  const dateKey = new Date().toISOString().slice(0, 10);

  const [trade] = await db
    .insert(tradesTable)
    .values({
      strategyType: strategy.strategyType,
      strategyFrequency: freq === "INTRADAY" ? null : freq as "WEEKLY" | "BIWEEKLY" | "MONTHLY",
      underlying: strategy.underlying,
      status: "open",
      entryUnderlyingPrice: String(ltp),
      unrealizedPnl: "0",
      maxProfit: maxProfit != null ? String(maxProfit) : null,
      maxLoss: maxLoss != null ? String(maxLoss) : null,
      netPremium: String(netPremium),
      capitalDeployed: String(capitalPerTrade),
      strategyId: strategy.id,
    })
    .returning();

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
        quantity: l.quantity,
        entryPrice: String(l.entryPrice),
        currentPrice: String(l.currentPrice),
        lotSize: l.lotSize,
      })),
    )
    .returning();

  await db.update(strategiesTable)
    .set({ lastExecutedAt: new Date(), totalTradesPlaced: strategy.totalTradesPlaced + 1 })
    .where(eq(strategiesTable.id, id));

  await db.insert(activityEventsTable).values({
    type: "strategy_executed",
    tradeId: trade.id,
    strategyId: strategy.id,
    message: `${strategy.name} executed: ${strategy.strategyType} on ${strategy.underlying} (net ₹${netPremium.toFixed(2)}/lot)`,
    timestamp: new Date(),
  });

  await db.insert(dailyPnlTable).values({
    date: dateKey,
    underlying: strategy.underlying,
    strategyType: strategy.strategyType,
    strategyFrequency: freq === "INTRADAY" ? null : freq as "WEEKLY" | "BIWEEKLY" | "MONTHLY",
    tradeId: trade.id,
    netPremium: String(netPremium),
    realizedPnl: "0",
    capitalDeployed: String(capitalPerTrade),
    returnPct: "0",
    brokerageCost: String(brokerageCost),
    notes: `Entry at spot ${ltp}. Target expiry: ${targetExpiry}.`,
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
    netPremium,
    capitalDeployed: capitalPerTrade,
    maxProfit,
    maxLoss,
    notes: null,
    legs: formattedLegs,
    createdAt: trade.createdAt.toISOString(),
    updatedAt: trade.updatedAt.toISOString(),
  });
});

router.post("/strategies/:id/toggle", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
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
