import { db, strategiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const PRESET_STRATEGIES = [
  {
    name: "Nifty Weekly Iron Condor",
    strategyType: "IRON_CONDOR" as const,
    underlying: "NIFTY" as const,
    frequency: "WEEKLY" as const,
    isActive: false,
    lotMultiplier: 1,
    wingWidth: 200,
    capitalPerTrade: "90000",
    targetReturnPct: "1",
    brokerageCost: "300",
    entryTimeIst: "09:20",
    exitTimeIst: "15:15",
  },
  {
    name: "Sensex Weekly Iron Condor",
    strategyType: "IRON_CONDOR" as const,
    underlying: "SENSEX" as const,
    frequency: "WEEKLY" as const,
    isActive: false,
    lotMultiplier: 1,
    wingWidth: 500,
    capitalPerTrade: "90000",
    targetReturnPct: "1",
    brokerageCost: "300",
    entryTimeIst: "09:20",
    exitTimeIst: "15:15",
  },
  {
    name: "Nifty Biweekly Iron Condor",
    strategyType: "IRON_CONDOR" as const,
    underlying: "NIFTY" as const,
    frequency: "BIWEEKLY" as const,
    isActive: false,
    lotMultiplier: 1,
    wingWidth: 250,
    capitalPerTrade: "90000",
    targetReturnPct: "1",
    brokerageCost: "300",
    entryTimeIst: "09:20",
    exitTimeIst: "15:15",
  },
  {
    name: "Sensex Biweekly Iron Condor",
    strategyType: "IRON_CONDOR" as const,
    underlying: "SENSEX" as const,
    frequency: "BIWEEKLY" as const,
    isActive: false,
    lotMultiplier: 1,
    wingWidth: 600,
    capitalPerTrade: "90000",
    targetReturnPct: "1",
    brokerageCost: "300",
    entryTimeIst: "09:20",
    exitTimeIst: "15:15",
  },
  {
    name: "BankNifty Monthly Iron Condor",
    strategyType: "IRON_CONDOR" as const,
    underlying: "BANKNIFTY" as const,
    frequency: "MONTHLY" as const,
    isActive: false,
    lotMultiplier: 1,
    wingWidth: 500,
    capitalPerTrade: "90000",
    targetReturnPct: "1",
    brokerageCost: "300",
    entryTimeIst: "09:20",
    exitTimeIst: "15:15",
  },
  {
    name: "Intraday Expiry IC",
    strategyType: "INTRADAY_IC" as const,
    underlying: "NIFTY" as const,
    frequency: "INTRADAY" as const,
    isActive: false,
    lotMultiplier: 1,
    capitalPerTrade: "90000",
    maxBuyingLegPremium: "5",
    targetReturnPct: "1",
    brokerageCost: "300",
    entryTimeIst: "09:20",
    exitTimeIst: "15:20",
  },
];

export async function seedStrategiesIfEmpty() {
  const existing = await db.select().from(strategiesTable);
  if (existing.length > 0) return;

  await db.insert(strategiesTable).values(PRESET_STRATEGIES as any);
  console.log("[seed] Inserted 6 preset strategies");
}
