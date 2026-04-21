/**
 * Fyers API client — stub until credentials are provided.
 * Set FYERS_APP_ID and FYERS_SECRET_KEY env vars to enable live mode.
 * The market-adapter.ts checks for these vars and routes to this client.
 */

const FYERS_SYMBOL_MAP: Record<string, string> = {
  NIFTY: "NSE:NIFTY50-INDEX",
  BANKNIFTY: "NSE:NIFTYBANK-INDEX",
  FINNIFTY: "NSE:FINNIFTY-INDEX",
  SENSEX: "BSE:SENSEX-INDEX",
};

export function getFyersClient() {
  const appId = process.env.FYERS_APP_ID;
  const secretKey = process.env.FYERS_SECRET_KEY;
  const accessToken = process.env.FYERS_ACCESS_TOKEN;

  if (!appId || !secretKey) {
    throw new Error("Fyers credentials not configured. Set FYERS_APP_ID and FYERS_SECRET_KEY.");
  }

  return {
    async getQuote(symbol: string) {
      const fyersSymbol = FYERS_SYMBOL_MAP[symbol];
      if (!fyersSymbol) throw new Error(`Unknown symbol: ${symbol}`);

      const res = await fetch(`https://api-t1.fyers.in/data/quotes?symbols=${fyersSymbol}`, {
        headers: { Authorization: `${appId}:${accessToken}` },
      });
      const json = await res.json() as any;
      const d = json.d?.[0]?.v;
      if (!d) throw new Error("Fyers quote fetch failed");

      return {
        symbol,
        ltp: d.lp,
        open: d.o,
        high: d.h,
        low: d.l,
        change: d.ch,
        changePct: d.chp,
        vix: 0,
        timestamp: new Date().toISOString(),
      };
    },

    async getOptionChain(symbol: string, expiry: string) {
      throw new Error("Fyers option chain not yet implemented. Credentials required.");
    },

    async getExpiries(symbol: string) {
      throw new Error("Fyers expiries not yet implemented. Credentials required.");
    },
  };
}
