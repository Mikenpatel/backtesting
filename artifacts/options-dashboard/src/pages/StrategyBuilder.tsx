import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  useGetMultiOptionChain,
  useGetMarketQuote,
  useCreateTrade,
  getListTradesQueryKey,
  getGetMultiOptionChainQueryKey,
  getGetMarketQuoteQueryKey,
} from "@workspace/api-client-react";
import type { OptionStrike } from "@workspace/api-client-react";
import { Layers, X, Plus, Minus, CheckCircle2, AlertCircle } from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYMBOLS = ["NIFTY", "BANKNIFTY", "FINNIFTY"] as const;
type Symbol = (typeof SYMBOLS)[number];

const LOT_SIZES: Record<Symbol, number> = {
  NIFTY: 75,
  BANKNIFTY: 15,
  FINNIFTY: 65,
};

// ---------------------------------------------------------------------------
// Extensible column config
// Add a new column here and it automatically appears in both CALLS and PUTS.
// ---------------------------------------------------------------------------

type ChainCol = {
  key: string;
  header: string;
  callRender: (s: OptionStrike) => React.ReactNode;
  putRender: (s: OptionStrike) => React.ReactNode;
  callCls?: string;
  putCls?: string;
  align?: "left" | "right";
};

function fmtOi(n: number) {
  if (n >= 10_000_000) return (n / 10_000_000).toFixed(1) + "Cr";
  if (n >= 100_000)    return (n / 100_000).toFixed(1) + "L";
  if (n >= 1_000)      return (n / 1_000).toFixed(0) + "K";
  return n.toString();
}

const CHAIN_COLS: ChainCol[] = [
  {
    key: "oi",
    header: "OI",
    callRender: (s) => fmtOi(s.callOi),
    putRender:  (s) => fmtOi(s.putOi),
    align: "right",
    callCls: "text-muted-foreground",
    putCls:  "text-muted-foreground",
  },
  {
    key: "volume",
    header: "Vol",
    callRender: (s) => fmtOi(s.callVolume),
    putRender:  (s) => fmtOi(s.putVolume),
    align: "right",
    callCls: "text-muted-foreground",
    putCls:  "text-muted-foreground",
  },
  {
    key: "iv",
    header: "IV%",
    callRender: (s) => ((s.callIv ?? 0) * 100).toFixed(1) + "%",
    putRender:  (s) => ((s.putIv ?? 0) * 100).toFixed(1) + "%",
    align: "right",
    callCls: "text-blue-400",
    putCls:  "text-blue-400",
  },
  {
    key: "delta",
    header: "Δ",
    callRender: (s) => (s.callDelta ?? 0).toFixed(2),
    putRender:  (s) => (s.putDelta ?? 0).toFixed(2),
    align: "right",
    callCls: "text-muted-foreground",
    putCls:  "text-muted-foreground",
  },
  {
    key: "ltp",
    header: "LTP",
    callRender: (s) => s.callLtp.toFixed(2),
    putRender:  (s) => s.putLtp.toFixed(2),
    align: "right",
    callCls: "text-primary font-medium",
    putCls:  "text-red-400 font-medium",
  },
];

// ---------------------------------------------------------------------------
// Basket leg type
// ---------------------------------------------------------------------------

type BasketLeg = {
  id: string;
  strike: number;
  expiry: string;
  type: "CE" | "PE";
  action: "BUY" | "SELL";
  ltp: number;
  lots: number;
};

// ---------------------------------------------------------------------------
// Helper components
// ---------------------------------------------------------------------------

function Badge({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "weekly" | "monthly" }) {
  const cls = {
    default:  "bg-secondary text-secondary-foreground",
    weekly:   "bg-blue-500/20 text-blue-400",
    monthly:  "bg-orange-500/20 text-orange-400",
  }[variant];
  return <span className={`text-[9px] px-1 py-0.5 rounded font-bold uppercase ${cls}`}>{children}</span>;
}

function ActionBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  const base = "px-1.5 py-0.5 rounded text-[10px] font-bold transition-all";
  if (label === "S") {
    return (
      <button onClick={onClick} className={`${base} ${active ? "bg-red-500 text-white" : "bg-red-900/40 text-red-400 hover:bg-red-800/60"}`}>S</button>
    );
  }
  return (
    <button onClick={onClick} className={`${base} ${active ? "bg-green-500 text-white" : "bg-green-900/40 text-green-400 hover:bg-green-800/60"}`}>B</button>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function StrategyBuilder() {
  const [symbol, setSymbol] = useState<Symbol>("NIFTY");
  const [selectedExpiry, setSelectedExpiry] = useState<string>("");
  const [basket, setBasket] = useState<BasketLeg[]>([]);
  const [strategyName, setStrategyName] = useState("Custom Strategy");
  const [placedTradeId, setPlacedTradeId] = useState<number | null>(null);
  const [tradeError, setTradeError] = useState<string | null>(null);

  const qc = useQueryClient();
  const [, navigate] = useLocation();

  // Fetch all expiries + chains in one call
  const { data: multiData, isLoading: chainLoading } = useGetMultiOptionChain(
    { symbol },
    { query: { queryKey: getGetMultiOptionChainQueryKey({ symbol }), refetchInterval: 15_000 } }
  );

  const expiries = multiData?.availableExpiries ?? [];

  // Auto-select first expiry when symbol or expiry list changes
  const activeExpiry = selectedExpiry && expiries.includes(selectedExpiry)
    ? selectedExpiry
    : expiries[0] ?? "";

  // Fetch spot price
  const { data: quote } = useGetMarketQuote(
    { symbol },
    { query: { queryKey: getGetMarketQuoteQueryKey({ symbol }), refetchInterval: 5_000 } }
  );

  // Create trade mutation
  const createTrade = useCreateTrade({
    mutation: {
      onSuccess: (trade) => {
        setPlacedTradeId(trade.id);
        setTradeError(null);
        setBasket([]);
        qc.invalidateQueries({ queryKey: getListTradesQueryKey() });
        qc.invalidateQueries({ queryKey: getListTradesQueryKey({ status: "open" }) });
        qc.invalidateQueries({ queryKey: getListTradesQueryKey({ status: "all" }) });
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to place trade";
        setTradeError(msg);
      },
    },
  });

  const lotSize = LOT_SIZES[symbol];

  // Basket helpers
  function addLeg(strike: number, type: "CE" | "PE", ltp: number, action: "BUY" | "SELL", expiry: string) {
    const id = `${expiry}-${strike}-${type}-${action}`;
    if (basket.find((b) => b.id === id)) return;
    setBasket((prev) => [...prev, { id, strike, expiry, type, action, ltp, lots: 1 }]);
  }

  function removeLeg(id: string) {
    setBasket((prev) => prev.filter((b) => b.id !== id));
  }

  function toggleAction(id: string) {
    setBasket((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        const newAction = b.action === "BUY" ? "SELL" : "BUY";
        return { ...b, action: newAction, id: `${b.strike}-${b.type}-${newAction}` };
      })
    );
  }

  function adjustLots(id: string, delta: number) {
    setBasket((prev) =>
      prev.map((b) => b.id === id ? { ...b, lots: Math.max(1, b.lots + delta) } : b)
    );
  }

  // Is a given strike/type/expiry already in basket?
  function inBasket(strike: number, type: "CE" | "PE", expiry: string) {
    return basket.some((b) => b.strike === strike && b.type === type && b.expiry === expiry);
  }

  // Net premium calculation
  const netPremium = useMemo(() =>
    basket.reduce((sum, b) => {
      const sign = b.action === "SELL" ? 1 : -1;
      return sum + sign * b.ltp * b.lots * lotSize;
    }, 0),
    [basket, lotSize]
  );

  // Place trade
  function placeTrade() {
    if (basket.length === 0) return;
    setPlacedTradeId(null);
    setTradeError(null);
    createTrade.mutate({
      data: {
        strategyType: "MANUAL",
        underlying: symbol,
        notes: strategyName,
        legs: basket.map((b) => ({
          symbol,
          optionType: b.type,
          strike: b.strike,
          expiry: b.expiry,
          action: b.action,
          quantity: b.lots,
          entryPrice: b.ltp,
          lotSize,
        })),
      },
    });
  }

  const strikes = (multiData?.chains as Record<string, OptionStrike[]> | undefined)?.[activeExpiry] ?? [];
  const atmStrike = multiData?.atmStrike ?? 0;

  // Format expiry label for display
  function fmtExpiry(raw: string) {
    // raw is like "26MAY26" — show as "26 May"
    if (!raw || raw.length < 5) return raw;
    const months: Record<string, string> = {
      JAN:"Jan",FEB:"Feb",MAR:"Mar",APR:"Apr",MAY:"May",JUN:"Jun",
      JUL:"Jul",AUG:"Aug",SEP:"Sep",OCT:"Oct",NOV:"Nov",DEC:"Dec",
    };
    const day   = raw.slice(0, 2);
    const mon   = raw.slice(2, 5).toUpperCase();
    const yr    = raw.slice(5);
    return `${day} ${months[mon] ?? mon} '${yr}`;
  }

  // Detect monthly vs weekly expiry (last Thursday of month = monthly)
  function expiryFlag(raw: string): "M" | "W" {
    if (!raw || raw.length < 7) return "W";
    const months: Record<string, number> = {
      JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,
      JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11,
    };
    const day = parseInt(raw.slice(0, 2), 10);
    const mon = months[raw.slice(2, 5).toUpperCase()];
    const yr  = 2000 + parseInt(raw.slice(5), 10);
    if (isNaN(day) || mon === undefined || isNaN(yr)) return "W";
    const date = new Date(yr, mon, day);
    // Is this the last Thursday of the month?
    const nextThurs = new Date(date);
    nextThurs.setDate(date.getDate() + 7);
    return nextThurs.getMonth() !== date.getMonth() ? "M" : "W";
  }

  return (
    <div className="flex h-full flex-col">
      {/* Page header */}
      <div className="flex-none px-6 py-4 border-b border-border flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Layers size={18} className="text-primary" />
          <div>
            <h1 className="text-base font-semibold leading-none">Strategy Builder</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Select strikes to build a basket, then place the trade</p>
          </div>
        </div>

        {/* Symbol switcher */}
        <div className="flex gap-1 ml-4">
          {SYMBOLS.map((s) => (
            <button
              key={s}
              onClick={() => { setSymbol(s); setSelectedExpiry(""); }}
              className={`px-3 py-1 text-xs rounded font-medium transition-colors ${
                symbol === s ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Spot price */}
        {quote && (
          <div className="ml-auto flex items-center gap-4 text-sm">
            <div>
              <span className="text-muted-foreground text-xs">Spot  </span>
              <span className="font-mono-num font-bold">{quote.ltp.toLocaleString("en-IN")}</span>
            </div>
            {atmStrike > 0 && (
              <div>
                <span className="text-muted-foreground text-xs">ATM  </span>
                <span className="font-mono-num font-bold text-primary">{atmStrike.toLocaleString("en-IN")}</span>
              </div>
            )}
            <div>
              <span className="text-muted-foreground text-xs">Lot  </span>
              <span className="font-mono-num font-bold">{lotSize}</span>
            </div>
          </div>
        )}
      </div>

      {/* Expiry tabs */}
      <div className="flex-none border-b border-border bg-sidebar px-6 py-2 flex items-center gap-1 flex-wrap">
        <span className="text-xs text-muted-foreground mr-1">Expiry:</span>
        {chainLoading && expiries.length === 0 && <span className="text-xs text-muted-foreground">Loading…</span>}
        {expiries.map((exp) => {
          const flag = expiryFlag(exp);
          const isActive = activeExpiry === exp;
          return (
            <button
              key={exp}
              onClick={() => setSelectedExpiry(exp)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-all ${
                isActive
                  ? "bg-primary/10 text-primary border border-primary/30"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {fmtExpiry(exp)}
              <Badge variant={flag === "M" ? "monthly" : "weekly"}>{flag}</Badge>
            </button>
          );
        })}
      </div>

      {/* Main area: chain table + basket */}
      <div className="flex flex-1 overflow-hidden">
        {/* Option chain */}
        <div className="flex-1 overflow-auto">
          {chainLoading && (
            <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
              Loading option chain…
            </div>
          )}
          {!chainLoading && strikes.length === 0 && (
            <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
              No chain data for {symbol} / {activeExpiry}
            </div>
          )}
          {!chainLoading && strikes.length > 0 && (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 bg-sidebar z-10">
                {/* CALLS / PUTS header */}
                <tr>
                  <th
                    colSpan={CHAIN_COLS.length + 1}
                    className="py-1.5 text-center text-primary font-semibold border-b border-r border-border text-xs tracking-wider"
                  >
                    CALLS
                  </th>
                  <th className="py-1.5 px-4 text-center font-bold text-foreground border-b border-border text-xs">
                    STRIKE
                  </th>
                  <th
                    colSpan={CHAIN_COLS.length + 1}
                    className="py-1.5 text-center text-red-400 font-semibold border-b border-l border-border text-xs tracking-wider"
                  >
                    PUTS
                  </th>
                </tr>

                {/* Column headers */}
                <tr className="text-muted-foreground uppercase tracking-wider text-[10px]">
                  {/* Reverse order for calls (OI, Vol, IV, Δ, LTP → right to left, but we show left→right) */}
                  {[...CHAIN_COLS].reverse().map((col) => (
                    <th key={`ch-${col.key}`} className={`px-2 py-1.5 border-b border-border ${col.align === "right" ? "text-right" : "text-left"}`}>
                      {col.header}
                    </th>
                  ))}
                  <th className="px-2 py-1.5 text-center border-b border-r border-border">Add</th>
                  <th className="px-4 py-1.5 text-center font-bold text-foreground border-b border-border">Strike</th>
                  <th className="px-2 py-1.5 text-center border-b border-l border-border">Add</th>
                  {CHAIN_COLS.map((col) => (
                    <th key={`ph-${col.key}`} className={`px-2 py-1.5 border-b border-border ${col.align === "right" ? "text-left" : "text-right"}`}>
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {strikes.map((row) => {
                  const isAtm = row.strike === atmStrike;
                  const ceActive = inBasket(row.strike, "CE", activeExpiry);
                  const peActive = inBasket(row.strike, "PE", activeExpiry);

                  return (
                    <tr
                      key={row.strike}
                      className={`border-b border-border/40 ${isAtm ? "bg-primary/5" : "hover:bg-muted/20"} transition-colors`}
                    >
                      {/* Call columns — reversed so LTP is closest to strike */}
                      {[...CHAIN_COLS].reverse().map((col) => (
                        <td
                          key={`c-${col.key}`}
                          className={`px-2 py-2 font-mono-num text-right ${isAtm ? col.callCls?.replace("text-primary", "text-cyan-300") : (col.callCls ?? "")}`}
                        >
                          {col.callRender(row)}
                        </td>
                      ))}

                      {/* CE add buttons */}
                      <td className="px-2 py-2 text-center border-r border-border">
                        <div className="flex gap-1 justify-center">
                          <ActionBtn label="S" active={ceActive} onClick={() => addLeg(row.strike, "CE", row.callLtp, "SELL", activeExpiry)} />
                          <ActionBtn label="B" active={ceActive} onClick={() => addLeg(row.strike, "CE", row.callLtp, "BUY", activeExpiry)} />
                        </div>
                      </td>

                      {/* Strike */}
                      <td className={`px-4 py-2 text-center font-mono-num font-bold whitespace-nowrap ${isAtm ? "text-primary" : "text-foreground"}`}>
                        {row.strike.toLocaleString("en-IN")}
                        {isAtm && <span className="ml-1 text-[9px] text-muted-foreground font-normal">ATM</span>}
                      </td>

                      {/* PE add buttons */}
                      <td className="px-2 py-2 text-center border-l border-border">
                        <div className="flex gap-1 justify-center">
                          <ActionBtn label="S" active={peActive} onClick={() => addLeg(row.strike, "PE", row.putLtp, "SELL", activeExpiry)} />
                          <ActionBtn label="B" active={peActive} onClick={() => addLeg(row.strike, "PE", row.putLtp, "BUY", activeExpiry)} />
                        </div>
                      </td>

                      {/* Put columns */}
                      {CHAIN_COLS.map((col) => (
                        <td
                          key={`p-${col.key}`}
                          className={`px-2 py-2 font-mono-num text-left ${isAtm ? col.putCls?.replace("text-red-400", "text-red-300") : (col.putCls ?? "")}`}
                        >
                          {col.putRender(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Basket / Order panel */}
        <div className="w-72 flex-none border-l border-border bg-sidebar flex flex-col">
          {/* Strategy name */}
          <div className="px-4 py-3 border-b border-border">
            <label className="block text-xs text-muted-foreground mb-1">Strategy Name</label>
            <input
              value={strategyName}
              onChange={(e) => setStrategyName(e.target.value)}
              className="w-full bg-background border border-border rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:border-primary"
              placeholder="e.g. Iron Condor"
            />
          </div>

          {/* Legs header */}
          <div className="px-4 py-2 border-b border-border flex items-center justify-between text-xs text-muted-foreground uppercase tracking-wider">
            <span>Basket · {basket.length} {basket.length === 1 ? "leg" : "legs"}</span>
            {basket.length > 0 && (
              <button onClick={() => setBasket([])} className="hover:text-destructive transition-colors">
                Clear
              </button>
            )}
          </div>

          {/* Legs list */}
          <div className="flex-1 overflow-auto">
            {basket.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 px-4 text-center text-muted-foreground">
                <Layers size={28} className="opacity-20" />
                <p className="text-xs">Click <strong>B</strong> (Buy) or <strong>S</strong> (Sell) next to a strike to add legs</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {basket.map((leg) => {
                  const premium = leg.ltp * leg.lots * lotSize;
                  return (
                    <div key={leg.id} className="px-3 py-2.5">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5">
                          {/* Toggle BUY/SELL */}
                          <button
                            onClick={() => toggleAction(leg.id)}
                            className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-all ${
                              leg.action === "SELL"
                                ? "bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20"
                                : "bg-green-500/10 text-green-400 border-green-500/30 hover:bg-green-500/20"
                            }`}
                            title="Click to toggle BUY/SELL"
                          >
                            {leg.action}
                          </button>
                          <span className="font-mono-num text-xs font-semibold text-foreground">
                            {leg.strike.toLocaleString("en-IN")}
                          </span>
                          <span className={`text-[10px] px-1 py-0.5 rounded font-bold ${
                            leg.type === "CE"
                              ? "bg-primary/10 text-primary"
                              : "bg-red-500/10 text-red-400"
                          }`}>
                            {leg.type}
                          </span>
                          <span className="text-[10px] text-muted-foreground">{fmtExpiry(leg.expiry)}</span>
                        </div>
                        <button
                          onClick={() => removeLeg(leg.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <X size={12} />
                        </button>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          LTP <span className="font-mono-num text-foreground">{leg.ltp.toFixed(2)}</span>
                        </span>
                        {/* Lot adjuster */}
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-muted-foreground">Lots</span>
                          <button
                            onClick={() => adjustLots(leg.id, -1)}
                            className="w-5 h-5 rounded bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors"
                          >
                            <Minus size={10} />
                          </button>
                          <span className="w-5 text-center text-xs font-mono-num text-foreground">{leg.lots}</span>
                          <button
                            onClick={() => adjustLots(leg.id, +1)}
                            className="w-5 h-5 rounded bg-muted hover:bg-muted/80 flex items-center justify-center transition-colors"
                          >
                            <Plus size={10} />
                          </button>
                        </div>
                      </div>

                      <div className="mt-1 text-[10px] text-muted-foreground">
                        Premium:{" "}
                        <span className={leg.action === "SELL" ? "text-green-400" : "text-red-400"}>
                          {leg.action === "SELL" ? "+" : "−"}₹{premium.toFixed(0)}
                        </span>
                        <span className="ml-1">({leg.lots} × {lotSize})</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-border px-4 py-3 space-y-2.5">
            {/* Net premium */}
            {basket.length > 0 && (
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Net Premium</span>
                <span className={`font-mono-num font-bold ${netPremium >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {netPremium >= 0 ? "+" : ""}₹{netPremium.toFixed(0)}
                </span>
              </div>
            )}

            {/* Success message */}
            {placedTradeId !== null && (
              <div className="flex items-center gap-2 text-xs text-green-400 bg-green-500/10 border border-green-500/20 rounded px-2 py-1.5">
                <CheckCircle2 size={13} />
                <span>
                  Trade #{placedTradeId} placed!{" "}
                  <button
                    onClick={() => navigate("/trades")}
                    className="underline hover:no-underline"
                  >
                    View in Trades
                  </button>
                </span>
              </div>
            )}

            {/* Error message */}
            {tradeError && (
              <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded px-2 py-1.5">
                <AlertCircle size={13} />
                <span>{tradeError}</span>
              </div>
            )}

            {/* Place Trade button */}
            <button
              onClick={placeTrade}
              disabled={basket.length === 0 || createTrade.isPending}
              className={`w-full py-2 rounded text-sm font-semibold transition-all ${
                basket.length === 0
                  ? "bg-muted text-muted-foreground cursor-not-allowed"
                  : createTrade.isPending
                    ? "bg-primary/60 text-primary-foreground cursor-wait"
                    : "bg-primary text-primary-foreground hover:opacity-90"
              }`}
            >
              {createTrade.isPending
                ? "Placing…"
                : basket.length === 0
                  ? "Add legs to place trade"
                  : `Place Trade · ${basket.length} leg${basket.length > 1 ? "s" : ""}`}
            </button>

            {basket.length > 0 && !createTrade.isPending && (
              <p className="text-[10px] text-muted-foreground text-center">
                {symbol} · {basket.length} leg{basket.length > 1 ? "s" : ""} across {new Set(basket.map(b => b.expiry)).size} expir{new Set(basket.map(b => b.expiry)).size === 1 ? "y" : "ies"}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
