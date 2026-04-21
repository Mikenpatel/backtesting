import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";

type Underlying = "all" | "NIFTY" | "BANKNIFTY" | "FINNIFTY" | "SENSEX";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

async function fetchDailyPnl(params: Record<string, string>) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}/api/dashboard/daily-pnl${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error("Failed to fetch P&L data");
  return res.json() as Promise<{
    rows: Array<{
      id: number;
      date: string;
      underlying: string;
      strategyType: string;
      strategyFrequency: string | null;
      tradeId: number | null;
      netPremium: number;
      realizedPnl: number;
      capitalDeployed: number;
      returnPct: number;
      brokerageCost: number;
      cumulativePnl: number;
      notes: string | null;
    }>;
    summary: {
      totalRows: number;
      totalNetPremium: number;
      totalRealizedPnl: number;
      totalCapitalDeployed: number;
      totalBrokerageCost: number;
      overallReturnPct: number;
    };
  }>;
}

async function fetchCapitalSummary() {
  const res = await fetch(`${BASE}/api/dashboard/capital-summary`);
  if (!res.ok) throw new Error("Failed to fetch capital summary");
  return res.json() as Promise<{
    activeCapital: number;
    totalCapitalDeployed: number;
    totalRealizedPnl: number;
    totalUnrealizedPnl: number;
    overallReturnPct: number;
    byUnderlying: Array<{ underlying: string; capitalDeployed: number; pnl: number; returnPct: number; trades: number }>;
  }>;
}

function Pct({ v }: { v: number }) {
  const cls = v > 0 ? "profit" : v < 0 ? "loss" : "text-muted-foreground";
  return <span className={`font-mono-num text-xs ${cls}`}>{v >= 0 ? "+" : ""}{v.toFixed(2)}%</span>;
}

function Inr({ v, size = "sm" }: { v: number; size?: "sm" | "base" }) {
  const cls = v > 0 ? "profit" : v < 0 ? "loss" : "text-muted-foreground";
  return (
    <span className={`font-mono-num ${size === "base" ? "text-base font-semibold" : "text-sm"} ${cls}`}>
      {v >= 0 ? "+" : ""}₹{Math.abs(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-card-border rounded-md p-4">
      <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function downloadCsv(rows: any[], filename: string) {
  const headers = ["Date", "Underlying", "Strategy", "Frequency", "Net Premium", "Realized P&L", "Capital Deployed", "Return %", "Brokerage", "Cumulative P&L", "Notes"];
  const lines = rows.map((r) =>
    [r.date, r.underlying, r.strategyType, r.strategyFrequency ?? "", r.netPremium, r.realizedPnl, r.capitalDeployed, r.returnPct, r.brokerageCost, r.cumulativePnl, `"${r.notes ?? ""}"`].join(","),
  );
  const csv = [headers.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PnlStatement() {
  const [underlying, setUnderlying] = useState<Underlying>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const queryParams: Record<string, string> = {};
  if (underlying !== "all") queryParams.underlying = underlying;
  if (fromDate) queryParams.from = fromDate;
  if (toDate) queryParams.to = toDate;

  const { data: pnlData, isLoading } = useQuery({
    queryKey: ["daily-pnl", queryParams],
    queryFn: () => fetchDailyPnl(queryParams),
    refetchInterval: 30000,
  });

  const { data: capitalSummary } = useQuery({
    queryKey: ["capital-summary"],
    queryFn: fetchCapitalSummary,
    refetchInterval: 30000,
  });

  const rows = pnlData?.rows ?? [];
  const summary = pnlData?.summary;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">P&L Statement</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Day-wise trade record — capital deployed &amp; return tracking</p>
        </div>
        <button
          onClick={() => downloadCsv(rows, `pnl-statement-${new Date().toISOString().slice(0, 10)}.csv`)}
          disabled={rows.length === 0}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-secondary hover:bg-secondary/80 rounded transition-colors text-secondary-foreground disabled:opacity-40"
        >
          <Download size={13} />
          Export CSV
        </button>
      </div>

      {/* Capital Summary */}
      {capitalSummary && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Active Capital">
            <span className="font-mono-num text-base font-semibold text-foreground">
              ₹{capitalSummary.activeCapital.toLocaleString("en-IN")}
            </span>
          </StatCard>
          <StatCard label="Total Deployed">
            <span className="font-mono-num text-base font-semibold text-foreground">
              ₹{capitalSummary.totalCapitalDeployed.toLocaleString("en-IN")}
            </span>
          </StatCard>
          <StatCard label="Realized P&L">
            <Inr v={capitalSummary.totalRealizedPnl} size="base" />
          </StatCard>
          <StatCard label="Unrealized P&L">
            <Inr v={capitalSummary.totalUnrealizedPnl} size="base" />
          </StatCard>
          <StatCard label="Overall Return">
            <span className="text-base font-semibold">
              <Pct v={capitalSummary.overallReturnPct} />
            </span>
          </StatCard>
        </div>
      )}

      {/* By Underlying breakdown */}
      {capitalSummary && capitalSummary.byUnderlying.length > 0 && (
        <div className="bg-card border border-card-border rounded-md">
          <div className="px-4 py-3 border-b border-border text-sm font-medium">Capital by Instrument</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wider">
                  <th className="px-4 py-2 text-left">Instrument</th>
                  <th className="px-4 py-2 text-right">Trades</th>
                  <th className="px-4 py-2 text-right">Capital Deployed</th>
                  <th className="px-4 py-2 text-right">P&L</th>
                  <th className="px-4 py-2 text-right">Return %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {capitalSummary.byUnderlying.map((row) => (
                  <tr key={row.underlying} className="hover:bg-muted/20">
                    <td className="px-4 py-2 font-semibold">{row.underlying}</td>
                    <td className="px-4 py-2 text-right font-mono-num text-muted-foreground">{row.trades}</td>
                    <td className="px-4 py-2 text-right font-mono-num">₹{row.capitalDeployed.toLocaleString("en-IN")}</td>
                    <td className="px-4 py-2 text-right"><Inr v={row.pnl} /></td>
                    <td className="px-4 py-2 text-right"><Pct v={row.returnPct} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {(["all", "NIFTY", "BANKNIFTY", "SENSEX", "FINNIFTY"] as Underlying[]).map((u) => (
            <button
              key={u}
              onClick={() => setUnderlying(u)}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${underlying === u ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}
            >
              {u === "all" ? "All" : u}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="bg-secondary border border-input rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="text-muted-foreground text-xs">to</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="bg-secondary border border-input rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {(fromDate || toDate) && (
            <button onClick={() => { setFromDate(""); setToDate(""); }} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
          )}
        </div>
      </div>

      {/* Summary strip */}
      {summary && rows.length > 0 && (
        <div className="flex flex-wrap gap-6 px-4 py-3 bg-card border border-card-border rounded-md text-sm">
          <div><span className="text-xs text-muted-foreground uppercase">Entries</span><span className="ml-2 font-mono-num font-medium">{summary.totalRows}</span></div>
          <div><span className="text-xs text-muted-foreground uppercase">Net Premium</span><span className="ml-2 font-mono-num font-medium">₹{summary.totalNetPremium.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span></div>
          <div><span className="text-xs text-muted-foreground uppercase">Realized P&L</span><span className="ml-2"><Inr v={summary.totalRealizedPnl} /></span></div>
          <div><span className="text-xs text-muted-foreground uppercase">Brokerage</span><span className="ml-2 font-mono-num text-muted-foreground">₹{summary.totalBrokerageCost.toLocaleString("en-IN")}</span></div>
          <div><span className="text-xs text-muted-foreground uppercase">Capital</span><span className="ml-2 font-mono-num">₹{summary.totalCapitalDeployed.toLocaleString("en-IN")}</span></div>
          <div><span className="text-xs text-muted-foreground uppercase">Return</span><span className="ml-2"><Pct v={summary.overallReturnPct} /></span></div>
        </div>
      )}

      {/* Day-wise table */}
      <div className="bg-card border border-card-border rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-3 py-3 text-left">Instrument</th>
                <th className="px-3 py-3 text-left">Strategy</th>
                <th className="px-3 py-3 text-right">Net Premium</th>
                <th className="px-3 py-3 text-right">Realized P&L</th>
                <th className="px-3 py-3 text-right">Capital</th>
                <th className="px-3 py-3 text-right">Return %</th>
                <th className="px-3 py-3 text-right">Brokerage</th>
                <th className="px-3 py-3 text-right">Cumulative</th>
                <th className="px-4 py-3 text-left">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">Loading records...</td></tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                    No records yet. Execute a strategy from the Strategies page to start tracking.
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 font-mono-num text-xs text-muted-foreground whitespace-nowrap">{row.date}</td>
                  <td className="px-3 py-2.5 font-semibold">{row.underlying}</td>
                  <td className="px-3 py-2.5">
                    <span className="text-xs bg-secondary px-1.5 py-0.5 rounded text-secondary-foreground">
                      {row.strategyType.replace(/_/g, " ")}
                      {row.strategyFrequency ? ` · ${row.strategyFrequency}` : ""}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono-num text-xs">₹{row.netPremium.toFixed(2)}</td>
                  <td className="px-3 py-2.5 text-right"><Inr v={row.realizedPnl} /></td>
                  <td className="px-3 py-2.5 text-right font-mono-num text-xs text-muted-foreground">₹{row.capitalDeployed.toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2.5 text-right"><Pct v={row.returnPct} /></td>
                  <td className="px-3 py-2.5 text-right font-mono-num text-xs text-muted-foreground">₹{row.brokerageCost.toFixed(0)}</td>
                  <td className={`px-3 py-2.5 text-right font-mono-num text-xs ${row.cumulativePnl >= 0 ? "profit" : "loss"}`}>
                    {row.cumulativePnl >= 0 ? "+" : ""}₹{row.cumulativePnl.toFixed(2)}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-48 truncate">{row.notes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
