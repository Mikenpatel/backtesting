import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateTrade,
  getListTradesQueryKey,
  useGetExpiries,
  getGetExpiriesQueryKey,
} from "@workspace/api-client-react";
import { Plus, Trash2 } from "lucide-react";

type Underlying = "NIFTY" | "BANKNIFTY" | "FINNIFTY";
type OptionType = "CE" | "PE";
type Action = "BUY" | "SELL";
type StrategyType = "IRON_CONDOR" | "CALENDAR_SPREAD" | "INTRADAY_EXPIRY" | "MANUAL";

const LOT_SIZES: Record<Underlying, number> = {
  NIFTY: 25,
  BANKNIFTY: 15,
  FINNIFTY: 40,
};

interface LegForm {
  optionType: OptionType;
  strike: string;
  expiry: string;
  action: Action;
  quantity: string;
  entryPrice: string;
}

export default function NewTrade() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const [underlying, setUnderlying] = useState<Underlying>("NIFTY");
  const [strategyType, setStrategyType] = useState<StrategyType>("MANUAL");
  const [notes, setNotes] = useState("");
  const [legs, setLegs] = useState<LegForm[]>([
    { optionType: "CE", strike: "", expiry: "", action: "BUY", quantity: "1", entryPrice: "" },
  ]);

  const { data: expiries } = useGetExpiries(
    { symbol: underlying },
    { query: { queryKey: getGetExpiriesQueryKey({ symbol: underlying }) } },
  );

  const createTrade = useCreateTrade({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListTradesQueryKey() });
        navigate("/trades");
      },
    },
  });

  const addLeg = () => {
    setLegs((prev) => [...prev, { optionType: "CE", strike: "", expiry: expiries?.expiries[0] ?? "", action: "BUY", quantity: "1", entryPrice: "" }]);
  };

  const removeLeg = (idx: number) => {
    setLegs((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateLeg = (idx: number, field: keyof LegForm, value: string) => {
    setLegs((prev) => prev.map((leg, i) => (i === idx ? { ...leg, [field]: value } : leg)));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const lotSize = LOT_SIZES[underlying];
    createTrade.mutate({
      data: {
        strategyType,
        underlying,
        notes: notes || null,
        legs: legs.map((leg) => ({
          symbol: underlying,
          optionType: leg.optionType,
          strike: parseFloat(leg.strike),
          expiry: leg.expiry,
          action: leg.action,
          quantity: parseInt(leg.quantity, 10) || 1,
          entryPrice: parseFloat(leg.entryPrice),
          lotSize,
        })),
      },
    });
  };

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">New Paper Trade</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Manually enter trade details with option legs</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic settings */}
        <div className="bg-card border border-card-border rounded-md p-5">
          <h2 className="text-sm font-medium mb-4">Trade Settings</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wide block mb-1.5">Underlying</label>
              <select
                value={underlying}
                onChange={(e) => setUnderlying(e.target.value as Underlying)}
                className="w-full bg-secondary border border-input rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="NIFTY">NIFTY (Lot: 25)</option>
                <option value="BANKNIFTY">BANKNIFTY (Lot: 15)</option>
                <option value="FINNIFTY">FINNIFTY (Lot: 40)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wide block mb-1.5">Strategy Type</label>
              <select
                value={strategyType}
                onChange={(e) => setStrategyType(e.target.value as StrategyType)}
                className="w-full bg-secondary border border-input rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="MANUAL">Manual</option>
                <option value="IRON_CONDOR">Iron Condor</option>
                <option value="CALENDAR_SPREAD">Calendar Spread</option>
                <option value="INTRADAY_EXPIRY">Intraday Expiry</option>
              </select>
            </div>
          </div>
          <div className="mt-4">
            <label className="text-xs text-muted-foreground uppercase tracking-wide block mb-1.5">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Trade rationale, observations..."
              className="w-full bg-secondary border border-input rounded px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
            />
          </div>
        </div>

        {/* Legs */}
        <div className="bg-card border border-card-border rounded-md p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-medium">Option Legs</h2>
            <button
              type="button"
              onClick={addLeg}
              className="flex items-center gap-1.5 text-xs text-primary hover:opacity-80 transition-opacity"
            >
              <Plus size={12} />
              Add Leg
            </button>
          </div>

          <div className="space-y-3">
            {legs.map((leg, idx) => (
              <div key={idx} className="grid grid-cols-6 gap-2 items-start">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Type</label>
                  <select
                    value={leg.optionType}
                    onChange={(e) => updateLeg(idx, "optionType", e.target.value)}
                    className="w-full bg-secondary border border-input rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="CE">CE</option>
                    <option value="PE">PE</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Strike</label>
                  <input
                    type="number"
                    value={leg.strike}
                    onChange={(e) => updateLeg(idx, "strike", e.target.value)}
                    placeholder="24500"
                    className="w-full bg-secondary border border-input rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono-num"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Expiry</label>
                  <select
                    value={leg.expiry}
                    onChange={(e) => updateLeg(idx, "expiry", e.target.value)}
                    className="w-full bg-secondary border border-input rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    required
                  >
                    <option value="">Select</option>
                    {(expiries?.expiries ?? []).map((exp) => (
                      <option key={exp} value={exp}>{exp}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Action</label>
                  <select
                    value={leg.action}
                    onChange={(e) => updateLeg(idx, "action", e.target.value)}
                    className="w-full bg-secondary border border-input rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    <option value="BUY">BUY</option>
                    <option value="SELL">SELL</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Entry ₹</label>
                  <input
                    type="number"
                    step="0.05"
                    value={leg.entryPrice}
                    onChange={(e) => updateLeg(idx, "entryPrice", e.target.value)}
                    placeholder="125.50"
                    className="w-full bg-secondary border border-input rounded px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring font-mono-num"
                    required
                  />
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => removeLeg(idx)}
                    disabled={legs.length === 1}
                    className="p-1.5 text-destructive hover:opacity-80 disabled:opacity-30 transition-opacity"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={createTrade.isPending}
            className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {createTrade.isPending ? "Placing..." : "Place Trade"}
          </button>
          <button
            type="button"
            onClick={() => navigate("/trades")}
            className="px-4 py-2 bg-secondary text-secondary-foreground rounded text-sm hover:opacity-80 transition-opacity"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
