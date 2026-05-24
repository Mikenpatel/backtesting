import { useState, useEffect } from "react";
import {
  useGetMarketQuote,
  getGetMarketQuoteQueryKey,
} from "@workspace/api-client-react";
import type { GetMarketQuoteParams } from "@workspace/api-client-react";
import { Radio, FlaskConical, ShieldAlert, TrendingUp, TrendingDown, Minus } from "lucide-react";

type IndexSymbol = GetMarketQuoteParams["symbol"] | "SENSEX";

interface MarketModeInfo {
  mode: "live" | "blocked" | "simulator";
  hasCredentials: boolean;
  reason: string;
}

function useMarketMode() {
  const [info, setInfo] = useState<MarketModeInfo | null>(null);
  useEffect(() => {
    const load = () =>
      fetch("/api/market/mode")
        .then((r) => r.json())
        .then((d) => setInfo(d as MarketModeInfo))
        .catch(() => null);
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);
  return info;
}

function ModeBadge({ info }: { info: MarketModeInfo | null }) {
  if (!info) return null;
  if (info.mode === "live") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30" title={info.reason}>
        <Radio size={11} className="animate-pulse" />
        LIVE · Fyers
      </span>
    );
  }
  if (info.mode === "blocked") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/25 cursor-help" title={info.reason}>
        <ShieldAlert size={11} />
        IP BLOCKED · Simulator
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/25" title={info.reason}>
      <FlaskConical size={11} />
      SIMULATOR
    </span>
  );
}

const REFRESH = { query: { refetchInterval: 5_000 } } as const;

const INDEX_META: { symbol: IndexSymbol; label: string; desc: string }[] = [
  { symbol: "NIFTY",     label: "NIFTY 50",       desc: "NSE Benchmark · Lot 75" },
  { symbol: "BANKNIFTY", label: "NIFTY BANK",      desc: "Banking Index · Lot 15" },
  { symbol: "FINNIFTY",  label: "NIFTY FIN SVC",   desc: "Financial Services · Lot 65" },
  { symbol: "SENSEX",    label: "SENSEX",           desc: "BSE Benchmark · Lot 10" },
];

const FNO_STOCKS = [
  { symbol: "RELIANCE",   sector: "Energy" },
  { symbol: "TCS",        sector: "IT" },
  { symbol: "INFY",       sector: "IT" },
  { symbol: "HDFCBANK",   sector: "Banking" },
  { symbol: "ICICIBANK",  sector: "Banking" },
  { symbol: "SBIN",       sector: "PSU Bank" },
  { symbol: "BAJFINANCE", sector: "NBFC" },
  { symbol: "AXISBANK",   sector: "Banking" },
  { symbol: "WIPRO",      sector: "IT" },
  { symbol: "TECHM",      sector: "IT" },
  { symbol: "MARUTI",     sector: "Auto" },
  { symbol: "TATAMOTORS", sector: "Auto" },
  { symbol: "ADANIENT",   sector: "Conglomerate" },
  { symbol: "HINDUNILVR", sector: "FMCG" },
  { symbol: "KOTAKBANK",  sector: "Banking" },
  { symbol: "LT",         sector: "Infra" },
];

function ChangeCell({ change, changePct }: { change?: number; changePct?: number }) {
  if (change == null || changePct == null) return <span className="text-muted-foreground">—</span>;
  const up = change >= 0;
  const cls = up ? "profit" : "loss";
  const Icon = up ? TrendingUp : change === 0 ? Minus : TrendingDown;
  return (
    <div className={`flex items-center gap-1 justify-end ${cls}`}>
      <Icon size={11} />
      <span className="font-mono-num text-xs">
        {up ? "+" : ""}{change.toFixed(2)}
      </span>
      <span className="font-mono-num text-xs opacity-75">
        ({up ? "+" : ""}{changePct.toFixed(2)}%)
      </span>
    </div>
  );
}

function IndexRow({ symbol, label, desc }: { symbol: IndexSymbol; label: string; desc: string }) {
  const sym = symbol as GetMarketQuoteParams["symbol"];
  const { data } = useGetMarketQuote(
    { symbol: sym },
    { query: { queryKey: getGetMarketQuoteQueryKey({ symbol: sym }), refetchInterval: 5_000 } },
  );
  const up = (data?.change ?? 0) >= 0;
  return (
    <tr className="border-b border-border/60 hover:bg-muted/20 transition-colors">
      <td className="px-4 py-3.5">
        <div className="font-semibold text-foreground text-sm">{label}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
      </td>
      <td className="px-4 py-3.5 text-right">
        <span className={`font-mono-num font-semibold text-base ${data ? (up ? "profit" : "loss") : "text-foreground"}`}>
          {data?.ltp?.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "—"}
        </span>
      </td>
      <td className="px-4 py-3.5 text-right">
        <ChangeCell change={data?.change} changePct={data?.changePct} />
      </td>
      <td className="px-4 py-3.5 text-right font-mono-num text-xs text-muted-foreground">
        {data?.high?.toLocaleString("en-IN") ?? "—"}
      </td>
      <td className="px-4 py-3.5 text-right font-mono-num text-xs text-muted-foreground">
        {data?.low?.toLocaleString("en-IN") ?? "—"}
      </td>
    </tr>
  );
}

function VixRow() {
  const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [vix, setVix] = useState<number | null>(null);
  useEffect(() => {
    const load = () =>
      fetch(`${BASE}/api/market/mode`)
        .then((r) => r.json())
        .then((d) => {
          if (typeof d.vix === "number") setVix(d.vix);
        })
        .catch(() => null);
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [BASE]);
  const cls = vix == null ? "text-muted-foreground" : vix > 20 ? "loss" : vix > 15 ? "text-yellow-400" : "profit";
  return (
    <tr className="border-b border-border/60 hover:bg-muted/20 transition-colors">
      <td className="px-4 py-3.5">
        <div className="font-semibold text-foreground text-sm">India VIX</div>
        <div className="text-xs text-muted-foreground mt-0.5">Volatility Index · Fear gauge</div>
      </td>
      <td className="px-4 py-3.5 text-right">
        <span className={`font-mono-num font-semibold text-base ${cls}`}>
          {vix?.toFixed(2) ?? "—"}
        </span>
      </td>
      <td className="px-4 py-3.5 text-right text-muted-foreground text-xs">—</td>
      <td className="px-4 py-3.5 text-right text-muted-foreground text-xs">—</td>
      <td className="px-4 py-3.5 text-right text-muted-foreground text-xs">—</td>
    </tr>
  );
}

export default function Market() {
  const mode = useMarketMode();

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Market</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Live indices &amp; F&amp;O watchlist</p>
        </div>
        <ModeBadge info={mode} />
      </div>

      {/* NSE / BSE Indices */}
      <div className="bg-card border border-card-border rounded-md overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <span className="text-sm font-medium">Indices</span>
          <span className="ml-2 text-xs text-muted-foreground">auto-refreshes every 5 s</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-2.5 text-left">Instrument</th>
                <th className="px-4 py-2.5 text-right">LTP</th>
                <th className="px-4 py-2.5 text-right">Change</th>
                <th className="px-4 py-2.5 text-right">High</th>
                <th className="px-4 py-2.5 text-right">Low</th>
              </tr>
            </thead>
            <tbody>
              {INDEX_META.map((m) => (
                <IndexRow key={m.symbol} {...m} />
              ))}
              <VixRow />
            </tbody>
          </table>
        </div>
      </div>

      {/* F&O Stock Watchlist */}
      <div className="bg-card border border-card-border rounded-md overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <span className="text-sm font-medium">Top F&amp;O Stocks</span>
          {mode && mode.mode !== "live" && (
            <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded">
              Prices require Fyers live connection
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-2.5 text-left">Symbol</th>
                <th className="px-4 py-2.5 text-left">Sector</th>
                <th className="px-4 py-2.5 text-right">LTP</th>
                <th className="px-4 py-2.5 text-right">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {FNO_STOCKS.map((stock) => (
                <tr key={stock.symbol} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-semibold text-sm text-foreground">{stock.symbol}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{stock.sector}</td>
                  <td className="px-4 py-3 text-right font-mono-num text-muted-foreground text-sm">—</td>
                  <td className="px-4 py-3 text-right text-muted-foreground text-xs">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {mode && mode.mode !== "live" && (
          <div className="px-4 py-3 border-t border-border text-xs text-muted-foreground">
            Connect your Fyers account and set <code className="bg-secondary px-1 rounded">FYERS_APP_ID</code> + <code className="bg-secondary px-1 rounded">FYERS_ACCESS_TOKEN</code> in the server <code className="bg-secondary px-1 rounded">.env</code> to stream live stock prices.
          </div>
        )}
      </div>

      {/* Market Hours Note */}
      <div className="text-xs text-muted-foreground px-1">
        NSE &amp; BSE market hours: <span className="text-foreground font-medium">09:15 – 15:30 IST</span> · Monday to Friday · Prices in simulator mode are Black-Scholes estimates seeded daily.
      </div>
    </div>
  );
}
