import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTrades,
  getListTradesQueryKey,
  useCloseTrade,
  useDeleteTrade,
} from "@workspace/api-client-react";
import type { Trade, TradeLeg } from "@workspace/api-client-react";
import { ChevronDown, ChevronRight, Plus, X, Check } from "lucide-react";

function PnlValue({ value, label }: { value: number | null | undefined; label?: string }) {
  if (value == null) return <span className="text-muted-foreground font-mono-num">—</span>;
  const cls = value > 0 ? "profit" : value < 0 ? "loss" : "text-muted-foreground";
  return (
    <span className={`font-mono-num ${cls}`}>
      {value > 0 ? "+" : ""}₹{Math.abs(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      {label && <span className="text-xs text-muted-foreground ml-1">{label}</span>}
    </span>
  );
}

function TradeRow({ trade, onClose, onDelete }: {
  trade: Trade;
  onClose: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isOpen = trade.status === "open";

  return (
    <>
      <tr
        className="hover:bg-muted/30 cursor-pointer transition-colors"
        onClick={() => setExpanded((e) => !e)}
      >
        <td className="px-4 py-3">
          {expanded ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
        </td>
        <td className="px-2 py-3">
          <span className="font-mono-num text-sm text-foreground font-medium">#{trade.id}</span>
        </td>
        <td className="px-2 py-3">
          <span className="text-sm font-semibold text-foreground">{trade.underlying}</span>
        </td>
        <td className="px-2 py-3">
          <span className="text-xs bg-secondary px-2 py-0.5 rounded text-secondary-foreground">
            {trade.strategyType.replace(/_/g, " ")}
          </span>
        </td>
        <td className="px-2 py-3">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${isOpen ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
            {trade.status}
          </span>
        </td>
        <td className="px-2 py-3 text-right">
          <PnlValue value={isOpen ? trade.unrealizedPnl : trade.realizedPnl} label={isOpen ? "unr." : "real."} />
        </td>
        <td className="px-2 py-3 text-right font-mono-num text-sm text-muted-foreground">
          ₹{(trade.entryUnderlyingPrice ?? 0).toLocaleString("en-IN")}
        </td>
        <td className="px-2 py-3 text-xs text-muted-foreground">
          {new Date(trade.entryTime).toLocaleDateString("en-IN")}
        </td>
        <td className="px-2 py-3">
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {isOpen && (
              <button
                onClick={() => onClose(trade.id)}
                title="Close trade"
                className="p-1 rounded hover:bg-primary/10 text-primary transition-colors"
              >
                <Check size={13} />
              </button>
            )}
            <button
              onClick={() => onDelete(trade.id)}
              title="Delete trade"
              className="p-1 rounded hover:bg-destructive/10 text-destructive transition-colors"
            >
              <X size={13} />
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={9} className="px-4 pb-3">
            <div className="bg-muted/20 rounded-md border border-border overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="px-3 py-2 text-left">Symbol</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Strike</th>
                    <th className="px-3 py-2 text-left">Expiry</th>
                    <th className="px-3 py-2 text-left">Action</th>
                    <th className="px-3 py-2 text-left">Qty</th>
                    <th className="px-3 py-2 text-right">Entry</th>
                    <th className="px-3 py-2 text-right">Current</th>
                    <th className="px-3 py-2 text-right">Exit</th>
                  </tr>
                </thead>
                <tbody>
                  {trade.legs.map((leg: TradeLeg) => (
                    <tr key={leg.id} className="border-b border-border/50 last:border-0">
                      <td className="px-3 py-2 font-medium">{leg.symbol}</td>
                      <td className="px-3 py-2">
                        <span className={leg.optionType === "CE" ? "text-primary" : "text-red-400"}>{leg.optionType}</span>
                      </td>
                      <td className="px-3 py-2 font-mono-num">{Number(leg.strike).toLocaleString("en-IN")}</td>
                      <td className="px-3 py-2">{leg.expiry}</td>
                      <td className="px-3 py-2">
                        <span className={leg.action === "BUY" ? "profit" : "loss"}>{leg.action}</span>
                      </td>
                      <td className="px-3 py-2 font-mono-num">{leg.quantity} × {leg.lotSize}</td>
                      <td className="px-3 py-2 text-right font-mono-num">₹{Number(leg.entryPrice).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono-num">₹{leg.currentPrice.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono-num">
                        {leg.exitPrice != null ? `₹${Number(leg.exitPrice).toFixed(2)}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function Trades() {
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed">("all");
  const qc = useQueryClient();

  const { data: trades, isLoading } = useListTrades(
    { status: statusFilter },
    { query: { queryKey: getListTradesQueryKey({ status: statusFilter }), refetchInterval: 30000 } },
  );

  const closeTrade = useCloseTrade({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListTradesQueryKey() });
        qc.invalidateQueries({ queryKey: getListTradesQueryKey({ status: "all" }) });
        qc.invalidateQueries({ queryKey: getListTradesQueryKey({ status: "open" }) });
        qc.invalidateQueries({ queryKey: getListTradesQueryKey({ status: "closed" }) });
      },
    },
  });

  const deleteTrade = useDeleteTrade({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListTradesQueryKey() });
        qc.invalidateQueries({ queryKey: getListTradesQueryKey({ status: "all" }) });
      },
    },
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Trades</h1>
          <p className="text-sm text-muted-foreground mt-0.5">All paper trades — click row to expand legs</p>
        </div>
        <Link href="/trades/new" className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded font-medium hover:opacity-90 transition-opacity">
          <Plus size={14} />
          New Trade
        </Link>
      </div>

      {/* Filter */}
      <div className="flex gap-1 mb-4">
        {(["all", "open", "closed"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-sm rounded transition-colors ${statusFilter === s ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <div className="bg-card border border-card-border rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-3 w-8"></th>
                <th className="px-2 py-3">ID</th>
                <th className="px-2 py-3">Underlying</th>
                <th className="px-2 py-3">Strategy</th>
                <th className="px-2 py-3">Status</th>
                <th className="px-2 py-3 text-right">P&amp;L</th>
                <th className="px-2 py-3 text-right">Spot Entry</th>
                <th className="px-2 py-3">Date</th>
                <th className="px-2 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground text-sm">Loading trades...</td>
                </tr>
              )}
              {!isLoading && (trades ?? []).length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    No trades found. Use the Strategies page to execute a strategy, or add a manual trade.
                  </td>
                </tr>
              )}
              {(trades ?? []).map((trade) => (
                <TradeRow
                  key={trade.id}
                  trade={trade}
                  onClose={(id) => closeTrade.mutate({ id })}
                  onDelete={(id) => deleteTrade.mutate({ id })}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
