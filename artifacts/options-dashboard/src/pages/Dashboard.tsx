import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useGetDashboardSummary,
  getGetDashboardSummaryQueryKey,
  useGetRecentActivity,
  getGetRecentActivityQueryKey,
  useListTrades,
  getListTradesQueryKey,
  useRefreshAllPnl,
} from "@workspace/api-client-react";
import { RefreshCw, ChevronRight } from "lucide-react";

function Pnl({ value }: { value: number }) {
  const cls = value > 0 ? "profit" : value < 0 ? "loss" : "text-muted-foreground";
  return (
    <span className={`font-mono-num ${cls}`}>
      {value > 0 ? "+" : ""}₹{Math.abs(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}

function StatCard({ label, children, sub }: { label: string; children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="bg-card border border-card-border rounded-md p-4">
      <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-semibold">{children}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const qc = useQueryClient();

  const { data: summary, isLoading: summaryLoading } = useGetDashboardSummary({
    query: { queryKey: getGetDashboardSummaryQueryKey(), refetchInterval: 30000 },
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

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Portfolio</h1>
          <p className="text-sm text-muted-foreground mt-0.5">NSE Paper Trading Overview</p>
        </div>
        <button
          onClick={() => refreshPnl.mutate()}
          disabled={refreshPnl.isPending}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 rounded transition-colors text-secondary-foreground disabled:opacity-50"
        >
          <RefreshCw size={13} className={refreshPnl.isPending ? "animate-spin" : ""} />
          Refresh P&amp;L
        </button>
      </div>

      {/* Market Ticker */}
      <div className="flex flex-wrap items-center gap-6 py-2.5 px-4 bg-card border border-card-border rounded-md text-sm">
        {[
          { label: "NIFTY", value: summary?.niftyLtp },
          { label: "BANKNIFTY", value: summary?.bankniftyLtp },
        ].map(({ label, value }) => (
          <div key={label} className="flex items-center gap-2">
            <span className="text-muted-foreground text-xs uppercase tracking-wider">{label}</span>
            <span className="font-mono-num font-semibold">{value?.toLocaleString("en-IN") ?? "—"}</span>
          </div>
        ))}
        <div className="w-px h-4 bg-border" />
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs uppercase tracking-wider">VIX</span>
          <span
            className={`font-mono-num font-semibold ${
              (summary?.vix ?? 0) > 20 ? "loss" : (summary?.vix ?? 0) > 15 ? "text-yellow-400" : "profit"
            }`}
          >
            {summary?.vix?.toFixed(2) ?? "—"}
          </span>
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          {summary?.activeStrategies ?? 0} active strategies
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total P&L"
          sub={`Realized + Unrealized`}
        >
          {summaryLoading ? <span className="text-muted-foreground text-base">—</span> : <Pnl value={summary?.totalPnl ?? 0} />}
        </StatCard>
        <StatCard label="Today's P&L">
          {summaryLoading ? <span className="text-muted-foreground text-base">—</span> : <Pnl value={summary?.todayPnl ?? 0} />}
        </StatCard>
        <StatCard
          label="Open Trades"
          sub={`${(summary?.openTrades ?? 0) + (summary?.closedTrades ?? 0)} total placed`}
        >
          <span className="font-mono-num">{summary?.openTrades ?? 0}</span>
        </StatCard>
        <StatCard
          label="Win Rate"
          sub={`${summary?.winningTrades ?? 0}W / ${summary?.losingTrades ?? 0}L`}
        >
          <span className={`font-mono-num ${(summary?.winRate ?? 0) >= 50 ? "profit" : "loss"}`}>
            {summary?.winRate?.toFixed(1) ?? "0.0"}%
          </span>
        </StatCard>
      </div>

      {/* Open Positions — Kite-style Holdings table */}
      <div className="bg-card border border-card-border rounded-md">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <span className="text-sm font-medium">Open Positions</span>
          <Link href="/trades" className="text-xs text-primary flex items-center gap-0.5 hover:underline">
            View all <ChevronRight size={12} />
          </Link>
        </div>

        {(openTrades ?? []).length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground mb-3">No open positions</p>
            <div className="flex items-center justify-center gap-3">
              <Link
                href="/chain-builder"
                className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                Build Strategy
              </Link>
              <Link
                href="/trades/new"
                className="px-3 py-1.5 text-xs rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 transition-colors"
              >
                Add Trade
              </Link>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wider">
                  <th className="px-4 py-2.5 text-left">Instrument</th>
                  <th className="px-3 py-2.5 text-left">Strategy</th>
                  <th className="px-3 py-2.5 text-center">Legs</th>
                  <th className="px-3 py-2.5 text-right">Entry Spot</th>
                  <th className="px-3 py-2.5 text-right">Unrealised P&amp;L</th>
                  <th className="px-3 py-2.5 text-left">Since</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(openTrades ?? []).map((trade) => {
                  const pnl = trade.unrealizedPnl ?? 0;
                  return (
                    <tr key={trade.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-foreground">{trade.underlying}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">#{trade.id}</div>
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-xs bg-secondary px-2 py-0.5 rounded text-secondary-foreground">
                          {trade.strategyType.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center font-mono-num text-muted-foreground">
                        {trade.legs.length}
                      </td>
                      <td className="px-3 py-3 text-right font-mono-num text-xs text-muted-foreground">
                        ₹{(trade.entryUnderlyingPrice ?? 0).toLocaleString("en-IN")}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Pnl value={pnl} />
                      </td>
                      <td className="px-3 py-3 text-xs text-muted-foreground">
                        {new Date(trade.entryTime).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Activity */}
      <div className="bg-card border border-card-border rounded-md">
        <div className="px-4 py-3 border-b border-border">
          <span className="text-sm font-medium">Recent Activity</span>
        </div>
        {(activity ?? []).length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">No activity yet</div>
        ) : (
          <div className="divide-y divide-border">
            {(activity ?? []).slice(0, 6).map((evt) => (
              <div key={evt.id} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm text-foreground">{evt.message}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {new Date(evt.timestamp).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                      hour12: false,
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })} IST
                  </div>
                </div>
                {evt.pnl != null && <Pnl value={evt.pnl} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
