import * as sim from "./market-simulator";
import { getFyersClient } from "./fyers-client";

export interface MarketQuote {
  symbol: string;
  ltp: number;
  open: number;
  high: number;
  low: number;
  change: number;
  changePct: number;
  vix: number;
  timestamp: string;
}

export interface OptionStrike {
  strike: number;
  callLtp: number;
  callOi: number;
  callVolume: number;
  callIv: number;
  callDelta: number;
  callTheta: number;
  callVega: number;
  putLtp: number;
  putOi: number;
  putVolume: number;
  putIv: number;
  putDelta: number;
  putTheta: number;
  putVega: number;
}

export interface OptionChain {
  symbol: string;
  expiry: string;
  underlyingLtp: number;
  atmStrike: number;
  strikes: OptionStrike[];
}

export function isLiveMode(): boolean {
  return !!(process.env.FYERS_APP_ID && process.env.FYERS_ACCESS_TOKEN);
}

export async function getQuote(symbol: string): Promise<MarketQuote> {
  if (isLiveMode()) {
    const client = getFyersClient();
    return client.getQuote(symbol);
  }
  return sim.getMarketQuote(symbol);
}

export async function getOptionChain(symbol: string, expiry: string): Promise<OptionChain> {
  if (isLiveMode()) {
    const client = getFyersClient();
    return client.getOptionChain(symbol, expiry);
  }
  return sim.getOptionChain(symbol, expiry);
}

export async function getExpiries(symbol: string): Promise<string[]> {
  if (isLiveMode()) {
    const client = getFyersClient();
    return client.getExpiries(symbol);
  }
  return sim.getExpiries(symbol);
}

export async function getCurrentOptionPrice(symbol: string, strike: number, optionType: "CE" | "PE", expiry: string): Promise<number> {
  if (isLiveMode()) {
    const chain = await getOptionChain(symbol, expiry);
    const row = chain.strikes.find((s) => s.strike === strike);
    return row ? (optionType === "CE" ? row.callLtp : row.putLtp) : 0;
  }
  return sim.getCurrentOptionPrice(symbol, strike, optionType, expiry);
}

export function getLotSize(symbol: string): number {
  return sim.getLotSize(symbol);
}

export function getStrikeInterval(symbol: string): number {
  return sim.getStrikeInterval(symbol);
}

export function getVix(): number {
  return sim.getVix();
}

export async function findIronCondorLegs(
  symbol: string,
  expiry: string,
  wingWidth: number,
  lotMultiplier = 1,
) {
  const chain = await getOptionChain(symbol, expiry);
  const lotSize = getLotSize(symbol);
  const interval = getStrikeInterval(symbol);
  const atmStrike = chain.atmStrike;

  const actualWing = Math.round(wingWidth / interval) * interval;

  const sellCallStrike = atmStrike + actualWing;
  const buyCallStrike = atmStrike + actualWing * 2;
  const sellPutStrike = atmStrike - actualWing;
  const buyPutStrike = atmStrike - actualWing * 2;

  const getPrice = (strike: number, type: "CE" | "PE") => {
    const row = chain.strikes.find((s) => s.strike === strike);
    return row ? (type === "CE" ? row.callLtp : row.putLtp) : 0;
  };

  const sellCallPrice = getPrice(sellCallStrike, "CE");
  const buyCallPrice = getPrice(buyCallStrike, "CE");
  const sellPutPrice = getPrice(sellPutStrike, "PE");
  const buyPutPrice = getPrice(buyPutStrike, "PE");

  const netCredit = sellCallPrice + sellPutPrice - buyCallPrice - buyPutPrice;
  const maxProfit = netCredit * lotSize * lotMultiplier;
  const maxLoss = (actualWing - netCredit) * lotSize * lotMultiplier;

  return {
    legs: [
      { symbol, optionType: "CE" as const, strike: sellCallStrike, expiry, action: "SELL" as const, quantity: lotMultiplier, entryPrice: sellCallPrice, currentPrice: sellCallPrice, lotSize },
      { symbol, optionType: "CE" as const, strike: buyCallStrike, expiry, action: "BUY" as const, quantity: lotMultiplier, entryPrice: buyCallPrice, currentPrice: buyCallPrice, lotSize },
      { symbol, optionType: "PE" as const, strike: sellPutStrike, expiry, action: "SELL" as const, quantity: lotMultiplier, entryPrice: sellPutPrice, currentPrice: sellPutPrice, lotSize },
      { symbol, optionType: "PE" as const, strike: buyPutStrike, expiry, action: "BUY" as const, quantity: lotMultiplier, entryPrice: buyPutPrice, currentPrice: buyPutPrice, lotSize },
    ],
    netCredit: Math.round(netCredit * 100) / 100,
    maxProfit: Math.round(maxProfit * 100) / 100,
    maxLoss: Math.round(maxLoss * 100) / 100,
    atmStrike,
  };
}

export async function findIntradayIcLegs(
  symbol: string,
  expiry: string,
  capitalDeployed: number,
  targetReturnPct: number,
  brokerageCost: number,
  maxBuyingLegPremium: number,
) {
  const chain = await getOptionChain(symbol, expiry);
  const lotSize = getLotSize(symbol);
  const atmStrike = chain.atmStrike;
  const strikes = chain.strikes;

  const targetPnl = (capitalDeployed * targetReturnPct) / 100;
  const netNeeded = targetPnl + brokerageCost;
  const netPointsNeeded = netNeeded / lotSize;

  const buyCallCandidates = strikes.filter((s) => s.strike > atmStrike && s.callLtp <= maxBuyingLegPremium);
  const buyPutCandidates = strikes.filter((s) => s.strike < atmStrike && s.putLtp <= maxBuyingLegPremium);

  const buyCall = buyCallCandidates[0];
  const buyPut = buyPutCandidates[buyPutCandidates.length - 1];

  const buyCallPremium = buyCall?.callLtp ?? maxBuyingLegPremium;
  const buyPutPremium = buyPut?.putLtp ?? maxBuyingLegPremium;
  const totalBuyPremium = buyCallPremium + buyPutPremium;
  const totalSellNeeded = netPointsNeeded + totalBuyPremium;

  const sellCallTarget = totalSellNeeded / 2;
  const sellPutTarget = totalSellNeeded / 2;

  const sellCallCandidates = strikes
    .filter((s) => s.strike > atmStrike && s.strike < (buyCall?.strike ?? atmStrike + 500) && s.callLtp >= sellCallTarget * 0.6)
    .sort((a, b) => Math.abs(a.callLtp - sellCallTarget) - Math.abs(b.callLtp - sellCallTarget));

  const sellPutCandidates = strikes
    .filter((s) => s.strike < atmStrike && s.strike > (buyPut?.strike ?? atmStrike - 500) && s.putLtp >= sellPutTarget * 0.6)
    .sort((a, b) => Math.abs(a.putLtp - sellPutTarget) - Math.abs(b.putLtp - sellPutTarget));

  const sellCall = sellCallCandidates[0] ?? strikes.find((s) => s.strike === atmStrike + getStrikeInterval(symbol));
  const sellPut = sellPutCandidates[0] ?? strikes.find((s) => s.strike === atmStrike - getStrikeInterval(symbol));

  const sellCallPremium = sellCall?.callLtp ?? 0;
  const sellPutPremium = sellPut?.putLtp ?? 0;
  const netCredit = sellCallPremium + sellPutPremium - buyCallPremium - buyPutPremium;

  return {
    legs: [
      { symbol, optionType: "CE" as const, strike: sellCall?.strike ?? atmStrike, expiry, action: "SELL" as const, quantity: 1, entryPrice: sellCallPremium, currentPrice: sellCallPremium, lotSize },
      { symbol, optionType: "CE" as const, strike: buyCall?.strike ?? atmStrike, expiry, action: "BUY" as const, quantity: 1, entryPrice: buyCallPremium, currentPrice: buyCallPremium, lotSize },
      { symbol, optionType: "PE" as const, strike: sellPut?.strike ?? atmStrike, expiry, action: "SELL" as const, quantity: 1, entryPrice: sellPutPremium, currentPrice: sellPutPremium, lotSize },
      { symbol, optionType: "PE" as const, strike: buyPut?.strike ?? atmStrike, expiry, action: "BUY" as const, quantity: 1, entryPrice: buyPutPremium, currentPrice: buyPutPremium, lotSize },
    ],
    netCredit: Math.round(netCredit * 100) / 100,
    netPointsNeeded: Math.round(netPointsNeeded * 100) / 100,
    targetPnl: Math.round(targetPnl * 100) / 100,
    maxBuyingLegPremium,
    atmStrike,
  };
}
