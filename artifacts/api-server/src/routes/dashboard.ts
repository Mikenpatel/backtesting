import { Router, type IRouter } from "express";
import { eq, and, gt, desc } from "drizzle-orm";
import { db, tradesTable, strategiesTable, activityEventsTable } from "@workspace/db";
import { getMarketQuote } from "../lib/market-simulator";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const allTrades = await db.select().from(tradesTable);
  const strategies = await db.select().from(strategiesTable).where(eq(strategiesTable.isActive, true));

  const openTrades = allTrades.filter((t) => t.status === "open");
  const closedTrades = allTrades.filter((t) => t.status === "closed");

  const totalUnrealizedPnl = openTrades.reduce((sum, t) => sum + Number(t.unrealizedPnl), 0);
  const totalRealizedPnl = closedTrades.reduce((sum, t) => sum + Number(t.realizedPnl ?? 0), 0);
  const totalPnl = totalUnrealizedPnl + totalRealizedPnl;

  const winningTrades = closedTrades.filter((t) => Number(t.realizedPnl ?? 0) > 0);
  const losingTrades = closedTrades.filter((t) => Number(t.realizedPnl ?? 0) <= 0);

  const winRate = closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0;
  const avgWin = winningTrades.length > 0
    ? winningTrades.reduce((sum, t) => sum + Number(t.realizedPnl ?? 0), 0) / winningTrades.length
    : 0;
  const avgLoss = losingTrades.length > 0
    ? losingTrades.reduce((sum, t) => sum + Number(t.realizedPnl ?? 0), 0) / losingTrades.length
    : 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTrades = closedTrades.filter((t) => t.exitTime && t.exitTime >= today);
  const todayPnl = todayTrades.reduce((sum, t) => sum + Number(t.realizedPnl ?? 0), 0)
    + openTrades.filter((t) => t.entryTime >= today).reduce((sum, t) => sum + Number(t.unrealizedPnl), 0);

  const niftyQuote = getMarketQuote("NIFTY");
  const bankniftyQuote = getMarketQuote("BANKNIFTY");

  res.json({
    totalUnrealizedPnl: Math.round(totalUnrealizedPnl * 100) / 100,
    totalRealizedPnl: Math.round(totalRealizedPnl * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    openTrades: openTrades.length,
    closedTrades: closedTrades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate: Math.round(winRate * 10) / 10,
    avgWin: Math.round(avgWin * 100) / 100,
    avgLoss: Math.round(avgLoss * 100) / 100,
    activeStrategies: strategies.length,
    niftyLtp: niftyQuote.ltp,
    bankniftyLtp: bankniftyQuote.ltp,
    vix: niftyQuote.vix,
    todayPnl: Math.round(todayPnl * 100) / 100,
  });
});

router.get("/dashboard/pnl-chart", async (_req, res): Promise<void> => {
  const closedTrades = await db
    .select()
    .from(tradesTable)
    .where(eq(tradesTable.status, "closed"))
    .orderBy(tradesTable.exitTime);

  const dailyPnl = new Map<string, number>();

  for (const trade of closedTrades) {
    if (!trade.exitTime) continue;
    const dateKey = trade.exitTime.toISOString().slice(0, 10);
    dailyPnl.set(dateKey, (dailyPnl.get(dateKey) ?? 0) + Number(trade.realizedPnl ?? 0));
  }

  const today = new Date();
  const points: Array<{ date: string; pnl: number; cumulativePnl: number }> = [];
  let cumulative = 0;

  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateKey = d.toISOString().slice(0, 10);
    const pnl = dailyPnl.get(dateKey) ?? 0;
    cumulative += pnl;
    points.push({
      date: dateKey,
      pnl: Math.round(pnl * 100) / 100,
      cumulativePnl: Math.round(cumulative * 100) / 100,
    });
  }

  res.json(points);
});

router.get("/dashboard/strategy-breakdown", async (_req, res): Promise<void> => {
  const allTrades = await db.select().from(tradesTable).where(eq(tradesTable.status, "closed"));

  const byType = new Map<string, { trades: number; pnl: number; wins: number }>();

  for (const trade of allTrades) {
    const existing = byType.get(trade.strategyType) ?? { trades: 0, pnl: 0, wins: 0 };
    const pnl = Number(trade.realizedPnl ?? 0);
    byType.set(trade.strategyType, {
      trades: existing.trades + 1,
      pnl: existing.pnl + pnl,
      wins: existing.wins + (pnl > 0 ? 1 : 0),
    });
  }

  const result = Array.from(byType.entries()).map(([strategyType, data]) => ({
    strategyType,
    trades: data.trades,
    pnl: Math.round(data.pnl * 100) / 100,
    winRate: data.trades > 0 ? Math.round((data.wins / data.trades) * 1000) / 10 : 0,
  }));

  res.json(result);
});

router.get("/dashboard/recent-activity", async (_req, res): Promise<void> => {
  const events = await db
    .select()
    .from(activityEventsTable)
    .orderBy(desc(activityEventsTable.timestamp))
    .limit(10);

  res.json(
    events.map((e) => ({
      id: e.id,
      type: e.type,
      tradeId: e.tradeId ?? null,
      strategyId: e.strategyId ?? null,
      message: e.message,
      pnl: e.pnl != null ? Number(e.pnl) : null,
      timestamp: e.timestamp.toISOString(),
    })),
  );
});

export default router;
