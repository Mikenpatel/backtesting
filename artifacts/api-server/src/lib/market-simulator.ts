import { logger } from "./logger";

const LOT_SIZES: Record<string, number> = {
  NIFTY: 25,
  BANKNIFTY: 15,
  FINNIFTY: 40,
};

const BASE_PRICES: Record<string, number> = {
  NIFTY: 24350,
  BANKNIFTY: 52800,
  FINNIFTY: 23900,
};

const BASE_VIX = 14.5;

function getElapsedMinutes(): number {
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(9, 15, 0, 0);
  return Math.max(0, (now.getTime() - startOfDay.getTime()) / 60000);
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed + 1) * 10000;
  return x - Math.floor(x);
}

function getDailyMovement(symbol: string): number {
  const today = new Date();
  const daySeed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  const symbolSeed = symbol.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const movement = (seededRandom(daySeed + symbolSeed) - 0.5) * 2;
  const maxMovement = symbol === "BANKNIFTY" ? 0.015 : 0.01;
  return movement * maxMovement;
}

export function getLtp(symbol: string): number {
  const base = BASE_PRICES[symbol] ?? 24000;
  const dailyMove = getDailyMovement(symbol);

  const elapsed = getElapsedMinutes();
  const intraMin = getElapsedMinutes();
  const noiseSeed = Math.floor(intraMin / 5);

  const noise = (seededRandom(noiseSeed * 17 + symbol.charCodeAt(0)) - 0.5) * 0.004;
  return Math.round((base * (1 + dailyMove + noise)) / 5) * 5;
}

export function getVix(): number {
  const today = new Date();
  const seed = today.getFullYear() * 10000 + today.getMonth() * 100 + today.getDate();
  const change = (seededRandom(seed * 7) - 0.5) * 2;
  return Math.round((BASE_VIX + change) * 100) / 100;
}

export function getMarketQuote(symbol: string) {
  const ltp = getLtp(symbol);
  const base = BASE_PRICES[symbol] ?? 24000;
  const dailyMove = getDailyMovement(symbol);
  const open = Math.round(base * (1 + dailyMove * 0.1));
  const high = Math.round(ltp * (1 + 0.003));
  const low = Math.round(ltp * (1 - 0.004));
  const change = ltp - open;
  const changePct = (change / open) * 100;
  const vix = getVix();

  return {
    symbol,
    ltp,
    open,
    high,
    low,
    change: Math.round(change * 100) / 100,
    changePct: Math.round(changePct * 100) / 100,
    vix,
    timestamp: new Date().toISOString(),
  };
}

export function getExpiries(symbol: string): string[] {
  const expiries: string[] = [];
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();

  for (let i = 0; i < 12; i++) {
    const d = new Date(year, month, today.getDate() + i);
    if (d.getDay() === 4) {
      expiries.push(formatExpiry(d));
      if (expiries.length >= 3) break;
    }
  }

  const monthlyExpiries = getMonthlyExpiries(today);
  for (const e of monthlyExpiries) {
    if (!expiries.includes(e)) expiries.push(e);
  }

  return expiries.slice(0, 6);
}

function getMonthlyExpiries(from: Date): string[] {
  const result: string[] = [];
  for (let m = 0; m < 3; m++) {
    const year = from.getFullYear();
    const month = from.getMonth() + m;
    const lastThursday = getLastThursdayOfMonth(year, month % 12, Math.floor(month / 12));
    result.push(formatExpiry(lastThursday));
  }
  return result;
}

function getLastThursdayOfMonth(year: number, month: number, yearOffset = 0): Date {
  const adjYear = year + yearOffset;
  const lastDay = new Date(adjYear, month + 1, 0);
  const dow = lastDay.getDay();
  const offset = (dow >= 4) ? dow - 4 : dow + 3;
  const d = new Date(adjYear, month, lastDay.getDate() - offset);
  return d;
}

function formatExpiry(d: Date): string {
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const day = String(d.getDate()).padStart(2, "0");
  const mon = months[d.getMonth()];
  const yr = String(d.getFullYear()).slice(2);
  return `${day}${mon}${yr}`;
}

function blackScholes(S: number, K: number, T: number, r: number, sigma: number, isCall: boolean): number {
  if (T <= 0) return Math.max(0, isCall ? S - K : K - S);

  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  const nd1 = normCdf(isCall ? d1 : -d1);
  const nd2 = normCdf(isCall ? d2 : -d2);

  if (isCall) {
    return S * nd1 - K * Math.exp(-r * T) * nd2;
  } else {
    return K * Math.exp(-r * T) * nd2 - S * nd1;
  }
}

function normCdf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

function getDelta(S: number, K: number, T: number, r: number, sigma: number, isCall: boolean): number {
  if (T <= 0) return isCall ? (S > K ? 1 : 0) : (S < K ? -1 : 0);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
  return isCall ? normCdf(d1) : normCdf(d1) - 1;
}

function getTheta(S: number, K: number, T: number, r: number, sigma: number, isCall: boolean): number {
  if (T <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  const nd1 = normCdf(d1);
  const phid1 = Math.exp(-d1 * d1 / 2) / Math.sqrt(2 * Math.PI);
  let theta: number;
  if (isCall) {
    theta = (-S * phid1 * sigma / (2 * Math.sqrt(T)) - r * K * Math.exp(-r * T) * normCdf(d2)) / 365;
  } else {
    theta = (-S * phid1 * sigma / (2 * Math.sqrt(T)) + r * K * Math.exp(-r * T) * normCdf(-d2)) / 365;
  }
  return Math.round(theta * 100) / 100;
}

function getVega(S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0) return 0;
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
  const phid1 = Math.exp(-d1 * d1 / 2) / Math.sqrt(2 * Math.PI);
  return Math.round(S * phid1 * Math.sqrt(T) * 100) / 100 / 100;
}

function parseExpiryToDate(expiry: string): Date {
  const months: Record<string, number> = {
    JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
    JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
  };
  const day = parseInt(expiry.slice(0, 2), 10);
  const mon = expiry.slice(2, 5).toUpperCase();
  const yr = 2000 + parseInt(expiry.slice(5, 7), 10);
  return new Date(yr, months[mon] ?? 0, day, 15, 30, 0);
}

export function getOptionChain(symbol: string, expiry: string) {
  const S = getLtp(symbol);
  const atmRaw = Math.round(S / 50) * 50;
  const today = new Date();
  const expiryDate = parseExpiryToDate(expiry);
  const T = Math.max(0.001, (expiryDate.getTime() - today.getTime()) / (365 * 24 * 60 * 60 * 1000));
  const r = 0.065;
  const baseIv = getVix() / 100;

  const strikes = [];
  for (let i = -10; i <= 10; i++) {
    const K = atmRaw + i * 50;
    const moneyness = Math.abs(i) / 10;
    const skew = isNaN(moneyness) ? 0 : moneyness * 0.02;
    const iv = baseIv + (i < 0 ? skew : 0);

    const callLtp = Math.max(0.05, blackScholes(S, K, T, r, iv, true));
    const putLtp = Math.max(0.05, blackScholes(S, K, T, r, iv, false));
    const callDelta = getDelta(S, K, T, r, iv, true);
    const putDelta = getDelta(S, K, T, r, iv, false);

    const oiBase = 1000000 * Math.exp(-Math.abs(i) * 0.3);
    const seed = K * 17 + today.getDate();
    const oiNoise = seededRandom(seed);

    strikes.push({
      strike: K,
      callLtp: Math.round(callLtp * 100) / 100,
      callOi: Math.round(oiBase * (0.8 + oiNoise * 0.4) / 25) * 25,
      callVolume: Math.round(oiBase * 0.1 * oiNoise),
      callIv: Math.round(iv * 10000) / 100,
      callDelta: Math.round(callDelta * 1000) / 1000,
      callTheta: getTheta(S, K, T, r, iv, true),
      callVega: getVega(S, K, T, r, iv),
      putLtp: Math.round(putLtp * 100) / 100,
      putOi: Math.round(oiBase * (0.8 + seededRandom(seed + 1) * 0.4) / 25) * 25,
      putVolume: Math.round(oiBase * 0.08 * seededRandom(seed + 2)),
      putIv: Math.round((iv + 0.01) * 10000) / 100,
      putDelta: Math.round(putDelta * 1000) / 1000,
      putTheta: getTheta(S, K, T, r, iv, false),
      putVega: getVega(S, K, T, r, iv),
    });
  }

  return {
    symbol,
    expiry,
    underlyingLtp: S,
    atmStrike: atmRaw,
    strikes,
  };
}

export function getCurrentOptionPrice(symbol: string, strike: number, optionType: "CE" | "PE", expiry: string): number {
  const chain = getOptionChain(symbol, expiry);
  const s = chain.strikes.find((x) => x.strike === strike);
  if (!s) {
    const S = getLtp(symbol);
    const T = Math.max(0.001, (parseExpiryToDate(expiry).getTime() - Date.now()) / (365 * 24 * 60 * 60 * 1000));
    const iv = getVix() / 100;
    return Math.max(0.05, blackScholes(S, strike, T, 0.065, iv, optionType === "CE"));
  }
  return optionType === "CE" ? s.callLtp : s.putLtp;
}

export function getLotSize(symbol: string): number {
  return LOT_SIZES[symbol] ?? 25;
}

export function buildIronCondorLegs(symbol: string, expiry: string, wingWidth: number) {
  const S = getLtp(symbol);
  const atmRaw = Math.round(S / 50) * 50;
  const lotSize = getLotSize(symbol);

  const sellCallStrike = atmRaw + wingWidth;
  const buyCallStrike = atmRaw + wingWidth * 2;
  const sellPutStrike = atmRaw - wingWidth;
  const buyPutStrike = atmRaw - wingWidth * 2;

  const sellCallPrice = getCurrentOptionPrice(symbol, sellCallStrike, "CE", expiry);
  const buyCallPrice = getCurrentOptionPrice(symbol, buyCallStrike, "CE", expiry);
  const sellPutPrice = getCurrentOptionPrice(symbol, sellPutStrike, "PE", expiry);
  const buyPutPrice = getCurrentOptionPrice(symbol, buyPutStrike, "PE", expiry);

  const netCredit = sellCallPrice + sellPutPrice - buyCallPrice - buyPutPrice;
  const maxProfit = netCredit * lotSize;
  const maxLoss = (wingWidth - netCredit) * lotSize;

  return {
    legs: [
      { symbol, optionType: "CE" as const, strike: sellCallStrike, expiry, action: "SELL" as const, quantity: 1, entryPrice: sellCallPrice, currentPrice: sellCallPrice, lotSize },
      { symbol, optionType: "CE" as const, strike: buyCallStrike, expiry, action: "BUY" as const, quantity: 1, entryPrice: buyCallPrice, currentPrice: buyCallPrice, lotSize },
      { symbol, optionType: "PE" as const, strike: sellPutStrike, expiry, action: "SELL" as const, quantity: 1, entryPrice: sellPutPrice, currentPrice: sellPutPrice, lotSize },
      { symbol, optionType: "PE" as const, strike: buyPutStrike, expiry, action: "BUY" as const, quantity: 1, entryPrice: buyPutPrice, currentPrice: buyPutPrice, lotSize },
    ],
    maxProfit: Math.round(maxProfit * 100) / 100,
    maxLoss: Math.round(maxLoss * 100) / 100,
  };
}

export function buildCalendarSpreadLegs(symbol: string, nearExpiry: string, farExpiry: string) {
  const S = getLtp(symbol);
  const atmRaw = Math.round(S / 50) * 50;
  const lotSize = getLotSize(symbol);

  const nearCallPrice = getCurrentOptionPrice(symbol, atmRaw, "CE", nearExpiry);
  const farCallPrice = getCurrentOptionPrice(symbol, atmRaw, "CE", farExpiry);

  const netDebit = farCallPrice - nearCallPrice;

  return {
    legs: [
      { symbol, optionType: "CE" as const, strike: atmRaw, expiry: nearExpiry, action: "SELL" as const, quantity: 1, entryPrice: nearCallPrice, currentPrice: nearCallPrice, lotSize },
      { symbol, optionType: "CE" as const, strike: atmRaw, expiry: farExpiry, action: "BUY" as const, quantity: 1, entryPrice: farCallPrice, currentPrice: farCallPrice, lotSize },
    ],
    maxProfit: Math.round(farCallPrice * lotSize * 0.3 * 100) / 100,
    maxLoss: Math.round(netDebit * lotSize * 100) / 100,
  };
}

export function buildIntradayExpiryLegs(symbol: string, expiry: string) {
  const S = getLtp(symbol);
  const atmRaw = Math.round(S / 50) * 50;
  const lotSize = getLotSize(symbol);

  const callPrice = getCurrentOptionPrice(symbol, atmRaw, "CE", expiry);
  const putPrice = getCurrentOptionPrice(symbol, atmRaw, "PE", expiry);

  const netCredit = callPrice + putPrice;

  return {
    legs: [
      { symbol, optionType: "CE" as const, strike: atmRaw, expiry, action: "SELL" as const, quantity: 1, entryPrice: callPrice, currentPrice: callPrice, lotSize },
      { symbol, optionType: "PE" as const, strike: atmRaw, expiry, action: "SELL" as const, quantity: 1, entryPrice: putPrice, currentPrice: putPrice, lotSize },
    ],
    maxProfit: Math.round(netCredit * lotSize * 100) / 100,
    maxLoss: null,
  };
}
