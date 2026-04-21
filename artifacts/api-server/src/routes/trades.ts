import { Router, type IRouter } from "express";
import { eq, desc, inArray } from "drizzle-orm";
import { db, tradesTable, tradeLegsTable, activityEventsTable, dailyPnlTable } from "@workspace/db";
import {
  CreateTradeBody,
  GetTradeParams,
  UpdateTradeBody,
  UpdateTradeParams,
  DeleteTradeParams,
  CloseTradeParams,
  ListTradesQueryParams,
} from "@workspace/api-zod";
import { getCurrentOptionPrice, getQuote } from "../lib/market-adapter";

const router: IRouter = Router();

function resolveSymbol(legSymbol: string): string {
  if (legSymbol.includes("BANKNIFTY")) return "BANKNIFTY";
  if (legSymbol.includes("FINNIFTY")) return "FINNIFTY";
  if (legSymbol.includes("SENSEX")) return "SENSEX";
  return legSymbol;
}

async function computeUnrealizedPnl(legs: typeof tradeLegsTable.$inferSelect[]): Promise<number> {
  let pnl = 0;
  for (const leg of legs) {
    const currentPrice = await getCurrentOptionPrice(
      resolveSymbol(leg.symbol),
      Number(leg.strike),
      leg.optionType as "CE" | "PE",
      leg.expiry,
    );
    const legPnl = (currentPrice - Number(leg.entryPrice)) * leg.quantity * leg.lotSize;
    pnl += leg.action === "SELL" ? -legPnl : legPnl;
  }
  return Math.round(pnl * 100) / 100;
}

async function formatTrade(trade: typeof tradesTable.$inferSelect, legs: typeof tradeLegsTable.$inferSelect[]) {
  const currentLegs = await Promise.all(
    legs.map(async (leg) => {
      const currentPrice = trade.status === "closed" && leg.exitPrice
        ? Number(leg.exitPrice)
        : await getCurrentOptionPrice(
            resolveSymbol(leg.symbol),
            Number(leg.strike),
            leg.optionType as "CE" | "PE",
            leg.expiry,
          );
      return {
        id: leg.id,
        tradeId: leg.tradeId,
        symbol: leg.symbol,
        optionType: leg.optionType,
        strike: Number(leg.strike),
        expiry: leg.expiry,
        action: leg.action,
        quantity: leg.quantity,
        entryPrice: Number(leg.entryPrice),
        exitPrice: leg.exitPrice != null ? Number(leg.exitPrice) : null,
        currentPrice,
        lotSize: leg.lotSize,
        createdAt: leg.createdAt.toISOString(),
      };
    }),
  );

  return {
    id: trade.id,
    strategyType: trade.strategyType,
    strategyFrequency: trade.strategyFrequency ?? null,
    underlying: trade.underlying,
    status: trade.status,
    entryTime: trade.entryTime.toISOString(),
    exitTime: trade.exitTime?.toISOString() ?? null,
    entryUnderlyingPrice: Number(trade.entryUnderlyingPrice),
    exitUnderlyingPrice: trade.exitUnderlyingPrice != null ? Number(trade.exitUnderlyingPrice) : null,
    unrealizedPnl: Number(trade.unrealizedPnl),
    realizedPnl: trade.realizedPnl != null ? Number(trade.realizedPnl) : null,
    netPremium: trade.netPremium != null ? Number(trade.netPremium) : null,
    capitalDeployed: trade.capitalDeployed != null ? Number(trade.capitalDeployed) : null,
    returnPct: trade.returnPct != null ? Number(trade.returnPct) : null,
    maxProfit: trade.maxProfit != null ? Number(trade.maxProfit) : null,
    maxLoss: trade.maxLoss != null ? Number(trade.maxLoss) : null,
    notes: trade.notes ?? null,
    legs: currentLegs,
    createdAt: trade.createdAt.toISOString(),
    updatedAt: trade.updatedAt.toISOString(),
  };
}

router.get("/trades", async (req, res): Promise<void> => {
  const parsed = ListTradesQueryParams.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { status } = parsed.data;
  let allTrades;
  if (status === "open") {
    allTrades = await db.select().from(tradesTable).where(eq(tradesTable.status, "open")).orderBy(desc(tradesTable.createdAt));
  } else if (status === "closed") {
    allTrades = await db.select().from(tradesTable).where(eq(tradesTable.status, "closed")).orderBy(desc(tradesTable.createdAt));
  } else {
    allTrades = await db.select().from(tradesTable).orderBy(desc(tradesTable.createdAt));
  }

  const tradeIds = allTrades.map((t) => t.id);
  const legs = tradeIds.length > 0
    ? await db.select().from(tradeLegsTable).where(inArray(tradeLegsTable.tradeId, tradeIds))
    : [];

  const legsMap = new Map<number, typeof tradeLegsTable.$inferSelect[]>();
  for (const leg of legs) {
    const arr = legsMap.get(leg.tradeId) ?? [];
    arr.push(leg);
    legsMap.set(leg.tradeId, arr);
  }

  const result = await Promise.all(allTrades.map((t) => formatTrade(t, legsMap.get(t.id) ?? [])));
  res.json(result);
});

router.post("/trades", async (req, res): Promise<void> => {
  const parsed = CreateTradeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const { legs, ...tradeData } = parsed.data;
  const quote = await getQuote(tradeData.underlying);

  const [trade] = await db
    .insert(tradesTable)
    .values({
      ...tradeData,
      strategyFrequency: tradeData.strategyFrequency ?? null,
      entryUnderlyingPrice: String(quote.ltp),
      unrealizedPnl: "0",
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
        currentPrice: String(l.entryPrice),
        lotSize: l.lotSize,
      })),
    )
    .returning();

  await db.insert(activityEventsTable).values({
    type: "trade_opened",
    tradeId: trade.id,
    message: `${tradeData.strategyType} trade opened on ${tradeData.underlying}`,
    timestamp: new Date(),
  });

  res.status(201).json(await formatTrade(trade, insertedLegs));
});

router.get("/trades/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [trade] = await db.select().from(tradesTable).where(eq(tradesTable.id, id));
  if (!trade) { res.status(404).json({ error: "Trade not found" }); return; }

  const legs = await db.select().from(tradeLegsTable).where(eq(tradeLegsTable.tradeId, id));
  res.json(await formatTrade(trade, legs));
});

router.patch("/trades/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const parsed = UpdateTradeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [updated] = await db.update(tradesTable).set(parsed.data).where(eq(tradesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Trade not found" }); return; }

  const legs = await db.select().from(tradeLegsTable).where(eq(tradeLegsTable.tradeId, id));
  res.json(await formatTrade(updated, legs));
});

router.delete("/trades/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  await db.delete(tradeLegsTable).where(eq(tradeLegsTable.tradeId, id));
  const [deleted] = await db.delete(tradesTable).where(eq(tradesTable.id, id)).returning();
  if (!deleted) { res.status(404).json({ error: "Trade not found" }); return; }

  res.sendStatus(204);
});

router.post("/trades/:id/close", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [trade] = await db.select().from(tradesTable).where(eq(tradesTable.id, id));
  if (!trade) { res.status(404).json({ error: "Trade not found" }); return; }
  if (trade.status === "closed") { res.status(400).json({ error: "Trade already closed" }); return; }

  const legs = await db.select().from(tradeLegsTable).where(eq(tradeLegsTable.tradeId, id));
  const realizedPnl = await computeUnrealizedPnl(legs);
  const quote = await getQuote(trade.underlying);
  const exitLtp = quote.ltp;
  const capitalDeployed = Number(trade.capitalDeployed ?? 0);
  const returnPct = capitalDeployed > 0 ? (realizedPnl / capitalDeployed) * 100 : 0;
  const dateKey = new Date().toISOString().slice(0, 10);

  await Promise.all(
    legs.map(async (leg) => {
      const exitPrice = await getCurrentOptionPrice(
        resolveSymbol(leg.symbol),
        Number(leg.strike),
        leg.optionType as "CE" | "PE",
        leg.expiry,
      );
      await db.update(tradeLegsTable).set({ exitPrice: String(exitPrice) }).where(eq(tradeLegsTable.id, leg.id));
    }),
  );

  const [updated] = await db
    .update(tradesTable)
    .set({
      status: "closed",
      exitTime: new Date(),
      exitUnderlyingPrice: String(exitLtp),
      realizedPnl: String(realizedPnl),
      unrealizedPnl: "0",
      returnPct: String(Math.round(returnPct * 10000) / 10000),
    })
    .where(eq(tradesTable.id, id))
    .returning();

  await db.insert(activityEventsTable).values({
    type: "trade_closed",
    tradeId: trade.id,
    message: `Trade closed on ${trade.underlying} | P&L: ₹${realizedPnl.toFixed(2)} (${returnPct.toFixed(2)}% return)`,
    pnl: String(realizedPnl),
    timestamp: new Date(),
  });

  const existingDailyPnl = await db.select().from(dailyPnlTable)
    .where(eq(dailyPnlTable.tradeId, id));

  if (existingDailyPnl.length > 0) {
    await db.update(dailyPnlTable)
      .set({
        realizedPnl: String(realizedPnl),
        returnPct: String(Math.round(returnPct * 10000) / 10000),
        notes: `Closed at spot ${exitLtp}. P&L: ₹${realizedPnl.toFixed(2)}`,
      })
      .where(eq(dailyPnlTable.tradeId, id));
  }

  const updatedLegs = await db.select().from(tradeLegsTable).where(eq(tradeLegsTable.tradeId, id));
  res.json(await formatTrade(updated!, updatedLegs));
});

router.post("/trades/refresh-pnl", async (req, res): Promise<void> => {
  const openTrades = await db.select().from(tradesTable).where(eq(tradesTable.status, "open"));

  let refreshed = 0;
  for (const trade of openTrades) {
    const legs = await db.select().from(tradeLegsTable).where(eq(tradeLegsTable.tradeId, trade.id));
    const unrealizedPnl = await computeUnrealizedPnl(legs);
    await db.update(tradesTable).set({ unrealizedPnl: String(unrealizedPnl) }).where(eq(tradesTable.id, trade.id));
    refreshed++;
  }

  res.json({ refreshed, message: `Refreshed P&L for ${refreshed} open trades` });
});

export default router;
