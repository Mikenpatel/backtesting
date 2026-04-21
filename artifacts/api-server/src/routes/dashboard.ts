import { Router, type IRouter } from "express";
import { eq, desc, asc } from "drizzle-orm";
import { db, tradesTable, strategiesTable, activityEventsTable, dailyPnlTable } from "@workspace/db";
import { getQuote, getVix } from "../lib/market-adapter";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res): Promise<void> => {
  const allTrades = await db.select().from(tradesTable);
  const strategies = await db.select().from(strategiesTable).where(eq(strategiesTable.isActive, true));

  const openTrades = allTrades.filter((t) => t.status === "open");
  const closedTrades = allTrades.filter((t) => t.status === "closed");

  const totalUnrealizedPnl = openTrades.reduce((sum, t) => sum + Number(t.unrealizedPnl), 0);
  const totalRealizedPnl = closedTrades.reduce((sum, t) => sum + Number(t.realizedPnl ?? 0), 0);
  const totalPnl = totalUnrealizedPnl + totalRealizedPnl;

  const totalCapital = allTrades.reduce((sum, t) => sum + Number(t.capitalDeployed ?? 0), 0);
  const totalReturn = totalCapital > 0 ? (totalPnl / totalCapital) * 100 : 0;

  const winningTrades = closedTrades.filter((t) => Number(t.realizedPnl ?? 0) > 0);
  const losingTrades = closedTrades.filter((t) => Number(t.realizedPnl ?? 0) <= 0);
  const winRate = closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0;
  const avgWin = winningTrades.length > 0
    ? winningTrades.reduce((sum, t) => sum + Number(t.realizedPnl ?? 0), 0) / winningTrades.length : 0;
  const avgLoss = losingTrades.length > 0
    ? losingTrades.reduce((sum, t) => sum + Number(t.realizedPnl ?? 0), 0) / losingTrades.length : 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTrades = closedTrades.filter((t) => t.exitTime && t.exitTime >= today);
  const todayPnl = todayTrades.reduce((sum, t) => sum + Number(t.realizedPnl ?? 0), 0)
    + openTrades.filter((t) => t.entryTime >= today).reduce((sum, t) => sum + Number(t.unrealizedPnl), 0);

  const [niftyQuote, bankniftyQuote] = await Promise.all([
    getQuote("NIFTY"),
    getQuote("BANKNIFTY"),
  ]);

  res.json({
    totalUnrealizedPnl: Math.round(totalUnrealizedPnl * 100) / 100,
    totalRealizedPnl: Math.round(totalRealizedPnl * 100) / 100,
    totalPnl: Math.round(totalPnl * 100) / 100,
    totalCapitalDeployed: Math.round(totalCapital * 100) / 100,
    totalReturnPct: Math.round(totalReturn * 100) / 100,
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
    vix: getVix(),
    todayPnl: Math.round(todayPnl * 100) / 100,
  });
});

router.get("/dashboard/pnl-chart", async (_req, res): Promise<void> => {
  const closedTrades = await db
    .select()
    .from(tradesTable)
    .where(eq(tradesTable.status, "closed"))
    .orderBy(tradesTable.exitTime);

  const dailyPnlMap = new Map<string, number>();
  for (const trade of closedTrades) {
    if (!trade.exitTime) continue;
    const dateKey = trade.exitTime.toISOString().slice(0, 10);
    dailyPnlMap.set(dateKey, (dailyPnlMap.get(dateKey) ?? 0) + Number(trade.realizedPnl ?? 0));
  }

  const today = new Date();
  const points: Array<{ date: string; pnl: number; cumulativePnl: number }> = [];
  let cumulative = 0;
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateKey = d.toISOString().slice(0, 10);
    const pnl = dailyPnlMap.get(dateKey) ?? 0;
    cumulative += pnl;
    points.push({ date: dateKey, pnl: Math.round(pnl * 100) / 100, cumulativePnl: Math.round(cumulative * 100) / 100 });
  }

  res.json(points);
});

router.get("/dashboard/strategy-breakdown", async (_req, res): Promise<void> => {
  const allTrades = await db.select().from(tradesTable).where(eq(tradesTable.status, "closed"));
  const byType = new Map<string, { trades: number; pnl: number; wins: number; capital: number }>();
  for (const trade of allTrades) {
    const existing = byType.get(trade.strategyType) ?? { trades: 0, pnl: 0, wins: 0, capital: 0 };
    const pnl = Number(trade.realizedPnl ?? 0);
    byType.set(trade.strategyType, {
      trades: existing.trades + 1,
      pnl: existing.pnl + pnl,
      wins: existing.wins + (pnl > 0 ? 1 : 0),
      capital: existing.capital + Number(trade.capitalDeployed ?? 0),
    });
  }

  const result = Array.from(byType.entries()).map(([strategyType, data]) => ({
    strategyType,
    trades: data.trades,
    pnl: Math.round(data.pnl * 100) / 100,
    winRate: data.trades > 0 ? Math.round((data.wins / data.trades) * 1000) / 10 : 0,
    returnPct: data.capital > 0 ? Math.round((data.pnl / data.capital) * 10000) / 100 : 0,
  }));

  res.json(result);
});

router.get("/dashboard/recent-activity", async (_req, res): Promise<void> => {
  const events = await db
    .select()
    .from(activityEventsTable)
    .orderBy(desc(activityEventsTable.timestamp))
    .limit(10);

  res.json(events.map((e) => ({
    id: e.id,
    type: e.type,
    tradeId: e.tradeId ?? null,
    strategyId: e.strategyId ?? null,
    message: e.message,
    pnl: e.pnl != null ? Number(e.pnl) : null,
    timestamp: e.timestamp.toISOString(),
  })));
});

router.get("/dashboard/daily-pnl", async (req, res): Promise<void> => {
  const { from, to, underlying } = req.query as Record<string, string>;

  let query = db.select().from(dailyPnlTable).$dynamic();

  const rows = await db.select().from(dailyPnlTable).orderBy(desc(dailyPnlTable.date));

  const filtered = rows.filter((r) => {
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    if (underlying && r.underlying !== underlying) return false;
    return true;
  });

  let runningPnl = 0;
  let runningCapital = 0;

  const result = filtered.reverse().map((r) => {
    runningPnl += Number(r.realizedPnl);
    runningCapital = Math.max(runningCapital, Number(r.capitalDeployed));
    const returnPct = Number(r.capitalDeployed) > 0
      ? (Number(r.realizedPnl) / Number(r.capitalDeployed)) * 100
      : 0;
    return {
      id: r.id,
      date: r.date,
      underlying: r.underlying,
      strategyType: r.strategyType,
      strategyFrequency: r.strategyFrequency ?? null,
      tradeId: r.tradeId ?? null,
      netPremium: Number(r.netPremium),
      realizedPnl: Number(r.realizedPnl),
      capitalDeployed: Number(r.capitalDeployed),
      returnPct: Math.round(returnPct * 100) / 100,
      brokerageCost: Number(r.brokerageCost),
      cumulativePnl: Math.round(runningPnl * 100) / 100,
      notes: r.notes ?? null,
    };
  }).reverse();

  const totalCapital = result.reduce((s, r) => s + r.capitalDeployed, 0);
  const totalPnl = result.reduce((s, r) => s + r.realizedPnl, 0);
  const totalNetPremium = result.reduce((s, r) => s + r.netPremium, 0);
  const totalBrokerage = result.reduce((s, r) => s + r.brokerageCost, 0);

  res.json({
    rows: result,
    summary: {
      totalRows: result.length,
      totalNetPremium: Math.round(totalNetPremium * 100) / 100,
      totalRealizedPnl: Math.round(totalPnl * 100) / 100,
      totalCapitalDeployed: Math.round(totalCapital * 100) / 100,
      totalBrokerageCost: Math.round(totalBrokerage * 100) / 100,
      overallReturnPct: totalCapital > 0 ? Math.round((totalPnl / totalCapital) * 10000) / 100 : 0,
    },
  });
});

router.get("/dashboard/capital-summary", async (_req, res): Promise<void> => {
  const allTrades = await db.select().from(tradesTable);

  const openTrades = allTrades.filter((t) => t.status === "open");
  const closedTrades = allTrades.filter((t) => t.status === "closed");

  const activeCapital = openTrades.reduce((s, t) => s + Number(t.capitalDeployed ?? 0), 0);
  const totalCapitalEver = allTrades.reduce((s, t) => s + Number(t.capitalDeployed ?? 0), 0);
  const totalRealizedPnl = closedTrades.reduce((s, t) => s + Number(t.realizedPnl ?? 0), 0);
  const totalUnrealizedPnl = openTrades.reduce((s, t) => s + Number(t.unrealizedPnl ?? 0), 0);

  const byUnderlying = new Map<string, { capital: number; pnl: number; trades: number }>();
  for (const t of allTrades) {
    const ex = byUnderlying.get(t.underlying) ?? { capital: 0, pnl: 0, trades: 0 };
    const pnl = t.status === "closed" ? Number(t.realizedPnl ?? 0) : Number(t.unrealizedPnl ?? 0);
    byUnderlying.set(t.underlying, { capital: ex.capital + Number(t.capitalDeployed ?? 0), pnl: ex.pnl + pnl, trades: ex.trades + 1 });
  }

  res.json({
    activeCapital: Math.round(activeCapital * 100) / 100,
    totalCapitalDeployed: Math.round(totalCapitalEver * 100) / 100,
    totalRealizedPnl: Math.round(totalRealizedPnl * 100) / 100,
    totalUnrealizedPnl: Math.round(totalUnrealizedPnl * 100) / 100,
    overallReturnPct: totalCapitalEver > 0 ? Math.round(((totalRealizedPnl + totalUnrealizedPnl) / totalCapitalEver) * 10000) / 100 : 0,
    byUnderlying: Array.from(byUnderlying.entries()).map(([u, d]) => ({
      underlying: u,
      capitalDeployed: Math.round(d.capital * 100) / 100,
      pnl: Math.round(d.pnl * 100) / 100,
      returnPct: d.capital > 0 ? Math.round((d.pnl / d.capital) * 10000) / 100 : 0,
      trades: d.trades,
    })),
  });
});

export default router;
