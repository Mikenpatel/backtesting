/**
 * Fyers API v3 client.
 * Set FYERS_APP_ID and FYERS_ACCESS_TOKEN env vars to enable live mode.
 * Auth header format: "{appId}:{accessToken}"
 * Base URL: https://api-t1.fyers.in/data/
 */

const BASE_URL = "https://api-t1.fyers.in/data";

const FYERS_SYMBOL_MAP: Record<string, string> = {
  NIFTY: "NSE:NIFTY50-INDEX",
  BANKNIFTY: "NSE:NIFTYBANK-INDEX",
  FINNIFTY: "NSE:FINNIFTY-INDEX",
  SENSEX: "BSE:SENSEX-INDEX",
};

// Strike intervals per underlying
const STRIKE_INTERVALS: Record<string, number> = {
  NIFTY: 50,
  BANKNIFTY: 100,
  FINNIFTY: 50,
  SENSEX: 100,
};

interface FyersQuoteValue {
  lp: number;     // last price
  o: number;      // open
  h: number;      // high
  l: number;      // low
  ch: number;     // change
  chp: number;    // change pct
}

interface FyersOptionLeg {
  n: string;      // symbol name e.g. NSE:NIFTY24MAY23500CE
  v: {
    ltp: number;
    bid_price: number;
    ask_price: number;
    volume: number;
    oi: number;
    iv: number;
    delta: number;
    theta: number;
    vega: number;
    gamma: number;
  };
}

interface FyersExpiryData {
  expiry: number;   // unix timestamp
  date: string;     // YYYY-MM-DD
  optionsChain: FyersOptionLeg[];
}

function getAuthHeader(): string {
  const appId = process.env.FYERS_APP_ID;
  const accessToken = process.env.FYERS_ACCESS_TOKEN;
  return `${appId}:${accessToken}`;
}

function parseStrikeFromSymbol(symbolName: string): { strike: number; type: "CE" | "PE" } | null {
  const match = symbolName.match(/(\d+)(CE|PE)$/);
  if (!match) return null;
  return { strike: parseInt(match[1], 10), type: match[2] as "CE" | "PE" };
}

async function fyersFetch<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE_URL}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url.toString(), {
    headers: { Authorization: getAuthHeader() },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Fyers API error ${res.status}: ${text}`);
  }

  const json = await res.json() as { s: string; message?: string; d?: T };
  if (json.s !== "ok") {
    throw new Error(`Fyers API returned status '${json.s}': ${json.message ?? "unknown error"}`);
  }

  return json.d as T;
}

export function getFyersClient() {
  return {
    /**
     * Fetch real-time quote for an index (NIFTY, BANKNIFTY, SENSEX, FINNIFTY).
     */
    async getQuote(symbol: string) {
      const fyersSymbol = FYERS_SYMBOL_MAP[symbol];
      if (!fyersSymbol) throw new Error(`Unknown symbol: ${symbol}`);

      type QuoteResponse = Array<{ n: string; s: string; v: FyersQuoteValue }>;
      const data = await fyersFetch<QuoteResponse>("quotes", { symbols: fyersSymbol });

      const q = data[0]?.v;
      if (!q) throw new Error(`No quote data returned for ${symbol}`);

      return {
        symbol,
        ltp: q.lp,
        open: q.o,
        high: q.h,
        low: q.l,
        change: q.ch,
        changePct: q.chp,
        vix: 0,
        timestamp: new Date().toISOString(),
      };
    },

    /**
     * Fetch full option chain for a given underlying and expiry date (YYYY-MM-DD).
     * If expiry is empty, fetches the nearest weekly expiry.
     */
    async getOptionChain(symbol: string, expiry: string) {
      const fyersSymbol = FYERS_SYMBOL_MAP[symbol];
      if (!fyersSymbol) throw new Error(`Unknown symbol: ${symbol}`);

      const params: Record<string, string> = {
        symbol: fyersSymbol,
        strikecount: "20",
      };

      // If a specific expiry date is given, find its unix timestamp
      if (expiry) {
        const ts = Math.floor(new Date(expiry).getTime() / 1000);
        params.timestamp = String(ts);
      }

      type OptionChainResponse = {
        expiryData: FyersExpiryData[];
        underlyingValue: number;
      };

      const data = await fyersFetch<OptionChainResponse>("optionchain", params);

      const expiryData = data.expiryData?.[0];
      if (!expiryData) throw new Error(`No option chain data for ${symbol}`);

      const underlyingLtp = data.underlyingValue;
      const interval = STRIKE_INTERVALS[symbol] ?? 50;
      const atmStrike = Math.round(underlyingLtp / interval) * interval;

      // Group legs by strike
      const strikeMap = new Map<number, {
        callLtp: number; callOi: number; callVolume: number;
        callIv: number; callDelta: number; callTheta: number; callVega: number;
        putLtp: number; putOi: number; putVolume: number;
        putIv: number; putDelta: number; putTheta: number; putVega: number;
      }>();

      for (const leg of expiryData.optionsChain) {
        const parsed = parseStrikeFromSymbol(leg.n);
        if (!parsed) continue;
        const { strike, type } = parsed;

        if (!strikeMap.has(strike)) {
          strikeMap.set(strike, {
            callLtp: 0, callOi: 0, callVolume: 0, callIv: 0, callDelta: 0, callTheta: 0, callVega: 0,
            putLtp: 0, putOi: 0, putVolume: 0, putIv: 0, putDelta: 0, putTheta: 0, putVega: 0,
          });
        }

        const row = strikeMap.get(strike)!;
        const v = leg.v;

        if (type === "CE") {
          row.callLtp = v.ltp;
          row.callOi = v.oi;
          row.callVolume = v.volume;
          row.callIv = v.iv;
          row.callDelta = v.delta;
          row.callTheta = v.theta;
          row.callVega = v.vega;
        } else {
          row.putLtp = v.ltp;
          row.putOi = v.oi;
          row.putVolume = v.volume;
          row.putIv = v.iv;
          row.putDelta = v.delta;
          row.putTheta = v.theta;
          row.putVega = v.vega;
        }
      }

      const strikes = Array.from(strikeMap.entries())
        .sort(([a], [b]) => a - b)
        .map(([strike, vals]) => ({ strike, ...vals }));

      return {
        symbol,
        expiry: expiryData.date,
        underlyingLtp,
        atmStrike,
        strikes,
      };
    },

    /**
     * Get available expiry dates for an underlying (nearest ~4 weekly expiries).
     */
    async getExpiries(symbol: string): Promise<string[]> {
      const fyersSymbol = FYERS_SYMBOL_MAP[symbol];
      if (!fyersSymbol) throw new Error(`Unknown symbol: ${symbol}`);

      type OptionChainResponse = {
        expiryData: FyersExpiryData[];
        underlyingValue: number;
      };

      const data = await fyersFetch<OptionChainResponse>("optionchain", {
        symbol: fyersSymbol,
        strikecount: "1",
      });

      return (data.expiryData ?? []).map((e) => e.date);
    },

    /**
     * Place a market order (for future real-trade use).
     * Currently stubbed — returns a placeholder order ID.
     */
    async placeOrder(params: {
      symbol: string;
      qty: number;
      type: "BUY" | "SELL";
      orderType: "MARKET" | "LIMIT";
      limitPrice?: number;
      productType?: "INTRADAY" | "CNC";
    }): Promise<{ orderId: string }> {
      const body = {
        symbol: params.symbol,
        qty: params.qty,
        type: params.type === "BUY" ? 1 : -1,
        orderType: params.orderType === "MARKET" ? 2 : 1,
        limitPrice: params.limitPrice ?? 0,
        productType: params.productType ?? "INTRADAY",
        validity: "DAY",
        offlineOrder: false,
        stopPrice: 0,
        disclosedQty: 0,
      };

      const res = await fetch("https://api-t1.fyers.in/api/v3/orders/sync", {
        method: "POST",
        headers: {
          Authorization: getAuthHeader(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const json = await res.json() as { s: string; id?: string; message?: string };
      if (json.s !== "ok") throw new Error(`Order failed: ${json.message}`);

      return { orderId: json.id ?? "" };
    },
  };
}
