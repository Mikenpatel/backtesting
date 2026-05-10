import { useState, useEffect } from "react";
import {
  useGetMarketQuote,
  getGetMarketQuoteQueryKey,
  useGetOptionChain,
  getGetOptionChainQueryKey,
  useGetExpiries,
  getGetExpiriesQueryKey,
} from "@workspace/api-client-react";
import { TrendingUp, TrendingDown, Radio, FlaskConical } from "lucide-react";

type Symbol = "NIFTY" | "BANKNIFTY" | "FINNIFTY";

interface MarketModeInfo {
  mode: "live" | "simulator";
  hasCredentials: boolean;
  reason: string;
}

function useMarketMode() {
  const [info, setInfo] = useState<MarketModeInfo | null>(null);
  useEffect(() => {
    fetch("/api/market/mode")
      .then((r) => r.json())
      .then((d) => setInfo(d as MarketModeInfo))
      .catch(() => null);
  }, []);
  return info;
}

function ModeBadge({ info }: { info: MarketModeInfo | null }) {
  if (!info) return null;
  if (info.mode === "live") {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
        title={info.reason}
      >
        <Radio size={11} className="animate-pulse" />
        LIVE · Fyers
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-yellow-500/10 text-yellow-400 border border-yellow-500/25"
      title={info.reason}
    >
      <FlaskConical size={11} />
      SIMULATOR
    </span>
  );
}

function QuoteCard({ symbol }: { symbol: Symbol }) {
  const { data: quote } = useGetMarketQuote(
    { symbol },
    { query: { queryKey: getGetMarketQuoteQueryKey({ symbol }), refetchInterval: 15000 } },
  );

  if (!quote) return <div className="bg-card border border-card-border rounded-md p-4 animate-pulse h-28" />;

  const isPositive = quote.change >= 0;

  return (
    <div className="bg-card border border-card-border rounded-md p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider">{quote.symbol}</span>
        {isPositive ? <TrendingUp size={14} className="profit" /> : <TrendingDown size={14} className="loss" />}
      </div>
      <div className="text-2xl font-mono-num font-semibold mb-1">{quote.ltp.toLocaleString("en-IN")}</div>
      <div className={`text-sm font-mono-num ${isPositive ? "profit" : "loss"}`}>
        {isPositive ? "+" : ""}{quote.change.toFixed(2)} ({isPositive ? "+" : ""}{quote.changePct.toFixed(2)}%)
      </div>
      <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
        <span>O: <span className="text-foreground font-mono-num">{quote.open.toLocaleString("en-IN")}</span></span>
        <span>H: <span className="text-foreground font-mono-num">{quote.high.toLocaleString("en-IN")}</span></span>
        <span>L: <span className="text-foreground font-mono-num">{quote.low.toLocaleString("en-IN")}</span></span>
      </div>
    </div>
  );
}

export default function Market() {
  const [selectedSymbol, setSelectedSymbol] = useState<Symbol>("NIFTY");
  const modeInfo = useMarketMode();

  const { data: expiries } = useGetExpiries(
    { symbol: selectedSymbol },
    { query: { queryKey: getGetExpiriesQueryKey({ symbol: selectedSymbol }) } },
  );

  const [selectedExpiry, setSelectedExpiry] = useState<string>("");
  const activeExpiry = selectedExpiry || expiries?.expiries[0] || "";

  const { data: chain, isLoading: chainLoading } = useGetOptionChain(
    { symbol: selectedSymbol, expiry: activeExpiry },
    {
      query: {
        queryKey: getGetOptionChainQueryKey({ symbol: selectedSymbol, expiry: activeExpiry }),
        enabled: !!activeExpiry,
        refetchInterval: 15000,
      },
    },
  );

  const niftyQuote = useGetMarketQuote({ symbol: "NIFTY" }, { query: { queryKey: getGetMarketQuoteQueryKey({ symbol: "NIFTY" }), refetchInterval: 15000 } });

  const subtitle = modeInfo?.mode === "live"
    ? "Live NSE/BSE data via Fyers API — refreshes every 15 seconds"
    : "Simulated NSE market data — refreshes every 15 seconds";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">Market</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
        </div>
        <ModeBadge info={modeInfo} />
      </div>

      {/* VIX bar */}
      <div className="flex items-center gap-3 py-2 px-4 bg-card border border-card-border rounded-md text-sm">
        <span className="text-xs text-muted-foreground uppercase">India VIX</span>
        <span className={`font-mono-num font-semibold ${(niftyQuote.data?.vix ?? 0) > 20 ? "loss" : (niftyQuote.data?.vix ?? 0) > 15 ? "text-yellow-400" : "profit"}`}>
          {niftyQuote.data?.vix.toFixed(2) ?? "—"}
        </span>
        <span className="text-xs text-muted-foreground ml-2">
          {(niftyQuote.data?.vix ?? 0) > 20 ? "High volatility" : (niftyQuote.data?.vix ?? 0) > 15 ? "Moderate volatility" : "Low volatility"}
        </span>
      </div>

      {/* Quote cards */}
      <div className="grid grid-cols-3 gap-4">
        <QuoteCard symbol="NIFTY" />
        <QuoteCard symbol="BANKNIFTY" />
        <QuoteCard symbol="FINNIFTY" />
      </div>

      {/* Option Chain */}
      <div className="bg-card border border-card-border rounded-md">
        <div className="px-4 py-3 border-b border-border flex items-center gap-4 flex-wrap">
          <span className="text-sm font-medium">Option Chain</span>

          <div className="flex gap-1">
            {(["NIFTY", "BANKNIFTY", "FINNIFTY"] as Symbol[]).map((sym) => (
              <button
                key={sym}
                onClick={() => { setSelectedSymbol(sym); setSelectedExpiry(""); }}
                className={`px-3 py-1 text-xs rounded transition-colors ${selectedSymbol === sym ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}
              >
                {sym}
              </button>
            ))}
          </div>

          <div className="flex gap-1">
            {(expiries?.expiries ?? []).slice(0, 5).map((exp) => (
              <button
                key={exp}
                onClick={() => setSelectedExpiry(exp)}
                className={`px-2 py-1 text-xs rounded font-mono-num transition-colors ${activeExpiry === exp ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {exp}
              </button>
            ))}
          </div>

          {chain && (
            <span className="ml-auto text-xs text-muted-foreground">
              Spot: <span className="text-foreground font-mono-num">{chain.underlyingLtp.toLocaleString("en-IN")}</span>
              &nbsp;·&nbsp;ATM: <span className="text-primary font-mono-num">{chain.atmStrike.toLocaleString("en-IN")}</span>
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th colSpan={5} className="py-2 text-center text-primary text-xs font-medium border-r border-border">CALLS</th>
                <th className="py-2 px-4 text-center font-bold text-foreground">STRIKE</th>
                <th colSpan={5} className="py-2 text-center text-red-400 text-xs font-medium border-l border-border">PUTS</th>
              </tr>
              <tr className="border-b border-border text-muted-foreground uppercase tracking-wider">
                <th className="px-2 py-2 text-right">OI</th>
                <th className="px-2 py-2 text-right">Vol</th>
                <th className="px-2 py-2 text-right">IV%</th>
                <th className="px-2 py-2 text-right">Delta</th>
                <th className="px-2 py-2 text-right border-r border-border">LTP</th>
                <th className="px-4 py-2 text-center font-bold text-foreground">Strike</th>
                <th className="px-2 py-2 text-left border-l border-border">LTP</th>
                <th className="px-2 py-2 text-left">Delta</th>
                <th className="px-2 py-2 text-left">IV%</th>
                <th className="px-2 py-2 text-left">Vol</th>
                <th className="px-2 py-2 text-left">OI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {chainLoading && (
                <tr><td colSpan={11} className="py-6 text-center text-muted-foreground">Loading option chain...</td></tr>
              )}
              {(chain?.strikes ?? []).map((row) => {
                const isAtm = row.strike === chain?.atmStrike;
                return (
                  <tr
                    key={row.strike}
                    className={`transition-colors ${isAtm ? "bg-primary/5 font-medium" : "hover:bg-muted/20"}`}
                  >
                    <td className="px-2 py-1.5 text-right font-mono-num text-muted-foreground">{(row.callOi / 1000).toFixed(0)}K</td>
                    <td className="px-2 py-1.5 text-right font-mono-num text-muted-foreground">{(row.callVolume / 1000).toFixed(0)}K</td>
                    <td className="px-2 py-1.5 text-right font-mono-num">{row.callIv.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-right font-mono-num text-primary">{row.callDelta.toFixed(3)}</td>
                    <td className="px-2 py-1.5 text-right font-mono-num text-primary border-r border-border font-medium">
                      {row.callLtp.toFixed(2)}
                    </td>
                    <td className={`px-4 py-1.5 text-center font-mono-num font-bold ${isAtm ? "text-primary" : "text-foreground"}`}>
                      {row.strike.toLocaleString("en-IN")}
                      {isAtm && <span className="ml-1 text-xs text-primary">(ATM)</span>}
                    </td>
                    <td className="px-2 py-1.5 text-left font-mono-num text-red-400 border-l border-border font-medium">
                      {row.putLtp.toFixed(2)}
                    </td>
                    <td className="px-2 py-1.5 text-left font-mono-num text-red-400">{row.putDelta.toFixed(3)}</td>
                    <td className="px-2 py-1.5 text-left font-mono-num">{row.putIv.toFixed(1)}</td>
                    <td className="px-2 py-1.5 text-left font-mono-num text-muted-foreground">{(row.putVolume / 1000).toFixed(0)}K</td>
                    <td className="px-2 py-1.5 text-left font-mono-num text-muted-foreground">{(row.putOi / 1000).toFixed(0)}K</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
