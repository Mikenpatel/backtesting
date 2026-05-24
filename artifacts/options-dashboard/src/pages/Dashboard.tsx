import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDashboardSummary,
  getGetDashboardSummaryQueryKey,
  useGetPnlChart,
  getGetPnlChartQueryKey,
  useGetStrategyBreakdown,
  getGetStrategyBreakdownQueryKey,
  useGetRecentActivity,
  getGetRecentActivityQueryKey,
  useListTrades,
  getListTradesQueryKey,
  useRefreshAllPnl,
} from "@workspace/api-client-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from "recharts";
import { RefreshCw, TrendingUp, TrendingDown, Activity, Target } from "lucide-react";

function PnlBadge({ value }: { value: number }) {
  const cls = value > 0 ? "profit" : value < 0 ? "loss" : "text-muted-foreground";
  const prefix = value > 0 ? "+" : "";
  return <span className={`pnl-value font-mono-num ${cls}`}>{prefix}₹{value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
}

function StatCard({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-card border border-card-border rounded-md p-4 ${className}`}>
      <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-semibold">{children}</div>
    </div>
  );
}

export default function Dashboard() {
  const qc = useQueryClient();

  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary({
    query: { queryKey: getGetDashboardSummaryQueryKey(), refetchInterval: 30000 },
  });
  const { data: pnlChart } = useGetPnlChart({
    query: { queryKey: getGetPnlChartQueryKey(), refetchInterval: 30000 },
  });
  const { data: stratBreakdown } = useGetStrategyBreakdown({
    query: { queryKey: getGetStrategyBreakdownQueryKey(), refetchInterval: 30000 },
  });
  const { data: activity } = useGetRecentActivity({
    query: { queryKey: getGetRecentActivityQueryKey(), refetchInterval: 15000 },
  });
  const { data: openTrades } = useListTrades(
    { status: "open" },
    { query: { queryKey: getListTradesQueryKey({ status: "open" }), refetchInterval: 30000 } },
  );

  const refreshPnl = useRefreshAllPnl({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        qc.invalidateQueries({ queryKey: getListTradesQueryKey({ status: "open" }) });
      },
    },
  });

  const chartData = pnlChart?.map((p) => ({
    date: p.date.slice(5),
    pnl: p.pnl,
    cum: p.cumulativePnl,
  })) ?? [];

  const stratColors = ["#06b6d4", "#6366f1", "#f59e0b", "#10b981"];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Portfolio overview — NSE paper trading</p>
        </div>
        <button
          onClick={() => refreshPnl.mutate()}
          disabled={refreshPnl.isPending}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 rounded transition-colors text-secondary-foreground"
        >
          <RefreshCw size={13} className={refreshPnl.isPending ? "animate-spin" : ""} />
          Refresh P&amp;L
        </button>
      </div>

      {/* Market Ticker */}
      <div className="flex items-center gap-6 py-2 px-4 bg-card border border-card-border rounded-md text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs uppercase">NIFTY</span>
          <span className="font-mono-num font-semibold">{summary?.niftyLtp.toLocaleString("en-IN") ?? "—"}</span>
        </div>
        <div className="w-px h-4 bg-border" />
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs uppercase">BANKNIFTY</span>
          <span className="font-mono-num font-semibold">{summary?.bankniftyLtp.toLocaleString("en-IN") ?? "—"}</span>
        </div>
        <div className="w-px h-4 bg-border" />
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs uppercase">VIX</span>
          <span className={`font-mono-num font-semibold ${(summary?.vix ?? 0) > 20 ? "loss" : (summary?.vix ?? 0) > 15 ? "text-yellow-400" : "profit"}`}>
            {summary?.vix?.toFixed(2) ?? "—"}
          </span>
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          Active strategies: <span className="text-foreground font-medium">{summary?.activeStrategies ?? 0}</span>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total P&L">
          {summaryLoading ? <span className="text-muted-foreground">—</span> : <PnlBadge value={summary?.totalPnl ?? 0} />}
        </StatCard>
        <StatCard label="Today's P&L">
          {summaryLoading ? <span className="text-muted-foreground">—</span> : <PnlBadge value={summary?.todayPnl ?? 0} />}
        </StatCard>
        <StatCard label="Open Trades">
          <span className="font-mono-num">{summary?.openTrades ?? 0}</span>
          <span className="text-xs text-muted-foreground ml-2">/ {(summary?.openTrades ?? 0) + (summary?.closedTrades ?? 0)} total</span>
        </StatCard>
        <StatCard label="Win Rate">
          <span className={`font-mono-num ${(summary?.winRate ?? 0) >= 50 ? "profit" : "loss"}`}>
            {summary?.winRate?.toFixed(1) ?? "0.0"}%
          </span>
          <span className="text-xs text-muted-foreground ml-2">{summary?.winningTrades ?? 0}W / {summary?.losingTrades ?? 0}L</span>
        </StatCard>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* P&L Chart */}
        <div className="md:col-span-2 bg-card border border-card-border rounded-md p-4">
          <div className="text-sm font-medium mb-3">Cumulative P&L (30 days)</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "hsl(215 20% 55%)" }} tickLine={false} axisLine={false} interval={6} />
              <YAxis tick={{ fontSize: 10, fill: "hsl(215 20% 55%)" }} tickLine={false} axisLine={false} tickFormatter={(v) => `₹${v >= 0 ? "" : "-"}${Math.abs(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ background: "hsl(222 47% 10%)", border: "1px solid hsl(217 33% 18%)", fontSize: 12 }}
                formatter={(v: number) => [`₹${v.toFixed(2)}`, "Cumulative P&L"]}
              />
              <Line type="monotone" dataKey="cum" stroke="hsl(187 100% 42%)" strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Strategy Breakdown */}
        <div className="bg-card border border-card-border rounded-md p-4">
          <div className="text-sm font-medium mb-3">By Strategy</div>
          {stratBreakdown && stratBreakdown.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={stratBreakdown} margin={{ top: 5, right: 5, left: 0, bottom: 5 }}>
                <XAxis dataKey="strategyType" tick={{ fontSize: 9, fill: "hsl(215 20% 55%)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 9, fill: "hsl(215 20% 55%)" }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "hsl(222 47% 10%)", border: "1px solid hsl(217 33% 18%)", fontSize: 12 }}
                  formatter={(v: number) => [`₹${v.toFixed(2)}`, "P&L"]}
                />
                <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                  {stratBreakdown.map((entry, idx) => (
                    <Cell key={idx} fill={entry.pnl >= 0 ? stratColors[idx % stratColors.length] : "#ef4444"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[180px] text-muted-foreground text-sm">No closed trades yet</div>
          )}
        </div>
      </div>

      {/* Bottom Row: Open Positions + Recent Activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Open Positions */}
        <div className="bg-card border border-card-border rounded-md">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Activity size={14} className="text-primary" />
            <span className="text-sm font-medium">Open Positions</span>
          </div>
          <div className="divide-y divide-border">
            {(openTrades ?? []).length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">No open trades</div>
            )}
            {(openTrades ?? []).slice(0, 5).map((trade) => (
              <div key={trade.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{trade.underlying}</div>
                  <div className="text-xs text-muted-foreground">{trade.strategyType.replace("_", " ")} · {trade.legs.length} legs</div>
                </div>
                <div className="text-right">
                  <PnlBadge value={trade.unrealizedPnl} />
                  <div className="text-xs text-muted-foreground mt-0.5">unrealized</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-card border border-card-border rounded-md">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <Target size={14} className="text-primary" />
            <span className="text-sm font-medium">Recent Activity</span>
          </div>
          <div className="divide-y divide-border">
            {(activity ?? []).length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">No recent activity</div>
            )}
            {(activity ?? []).slice(0, 6).map((evt) => (
              <div key={evt.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">{evt.message}</span>
                  {evt.pnl != null && <PnlBadge value={evt.pnl} />}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {new Date(evt.timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false })} IST
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
