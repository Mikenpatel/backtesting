import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListStrategies,
  getListStrategiesQueryKey,
  useToggleStrategy,
  useExecuteStrategy,
  useDeleteStrategy,
  useCreateStrategy,
} from "@workspace/api-client-react";
import { Plus, Play, ToggleLeft, ToggleRight, Trash2, X } from "lucide-react";

type StrategyType = "IRON_CONDOR" | "CALENDAR_SPREAD" | "INTRADAY_EXPIRY";
type Underlying = "NIFTY" | "BANKNIFTY" | "FINNIFTY";
type Frequency = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "INTRADAY";

const STRATEGY_LABELS: Record<StrategyType, string> = {
  IRON_CONDOR: "Iron Condor",
  CALENDAR_SPREAD: "Calendar Spread",
  INTRADAY_EXPIRY: "Intraday Expiry",
};

const STRATEGY_DESC: Record<StrategyType, string> = {
  IRON_CONDOR: "Sell OTM call spread + put spread. Profits from low volatility within a range.",
  CALENDAR_SPREAD: "Sell near-term ATM option, buy far-term. Profits from time decay difference.",
  INTRADAY_EXPIRY: "Short ATM straddle on expiry day. Profits from rapid theta decay.",
};

function PnlBadge({ value }: { value: number }) {
  const cls = value > 0 ? "profit" : value < 0 ? "loss" : "text-muted-foreground";
  return <span className={`font-mono-num text-sm ${cls}`}>{value >= 0 ? "+" : ""}₹{value.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span>;
}

interface CreateStrategyForm {
  name: string;
  strategyType: StrategyType;
  underlying: Underlying;
  frequency: Frequency;
  lotMultiplier: string;
  wingWidth: string;
  deltaTarget: string;
  stopLossPct: string;
  targetProfitPct: string;
  entryTimeIst: string;
  exitTimeIst: string;
}

function CreateStrategyModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CreateStrategyForm>({
    name: "",
    strategyType: "IRON_CONDOR",
    underlying: "NIFTY",
    frequency: "WEEKLY",
    lotMultiplier: "1",
    wingWidth: "200",
    deltaTarget: "0.15",
    stopLossPct: "50",
    targetProfitPct: "50",
    entryTimeIst: "09:45",
    exitTimeIst: "15:15",
  });

  const createStrategy = useCreateStrategy({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListStrategiesQueryKey() });
        onClose();
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createStrategy.mutate({
      data: {
        name: form.name,
        strategyType: form.strategyType,
        underlying: form.underlying,
        frequency: form.frequency,
        lotMultiplier: parseInt(form.lotMultiplier, 10) || 1,
        wingWidth: form.wingWidth ? parseInt(form.wingWidth, 10) : null,
        deltaTarget: form.deltaTarget ? parseFloat(form.deltaTarget) : null,
        stopLossPct: form.stopLossPct ? parseFloat(form.stopLossPct) : null,
        targetProfitPct: form.targetProfitPct ? parseFloat(form.targetProfitPct) : null,
        entryTimeIst: form.entryTimeIst || null,
        exitTimeIst: form.exitTimeIst || null,
      },
    });
  };

  const f = (field: keyof CreateStrategyForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-card-border rounded-lg w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-semibold text-sm">Create Strategy</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-muted-foreground uppercase tracking-wide block mb-1">Strategy Name</label>
              <input type="text" value={form.name} onChange={f("name")} required
                placeholder="e.g. Weekly Nifty IC"
                className="w-full bg-secondary border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wide block mb-1">Strategy Type</label>
              <select value={form.strategyType} onChange={f("strategyType")}
                className="w-full bg-secondary border border-input rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="IRON_CONDOR">Iron Condor</option>
                <option value="CALENDAR_SPREAD">Calendar Spread</option>
                <option value="INTRADAY_EXPIRY">Intraday Expiry</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wide block mb-1">Underlying</label>
              <select value={form.underlying} onChange={f("underlying")}
                className="w-full bg-secondary border border-input rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="NIFTY">NIFTY</option>
                <option value="BANKNIFTY">BANKNIFTY</option>
                <option value="FINNIFTY">FINNIFTY</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wide block mb-1">Frequency</label>
              <select value={form.frequency} onChange={f("frequency")}
                className="w-full bg-secondary border border-input rounded px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring">
                <option value="WEEKLY">Weekly</option>
                <option value="BIWEEKLY">Biweekly</option>
                <option value="MONTHLY">Monthly</option>
                <option value="INTRADAY">Intraday</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wide block mb-1">Lot Multiplier</label>
              <input type="number" min="1" value={form.lotMultiplier} onChange={f("lotMultiplier")}
                className="w-full bg-secondary border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring font-mono-num" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wide block mb-1">Wing Width (pts)</label>
              <input type="number" value={form.wingWidth} onChange={f("wingWidth")} placeholder="200"
                className="w-full bg-secondary border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring font-mono-num" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wide block mb-1">Stop Loss %</label>
              <input type="number" value={form.stopLossPct} onChange={f("stopLossPct")} placeholder="50"
                className="w-full bg-secondary border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring font-mono-num" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wide block mb-1">Target Profit %</label>
              <input type="number" value={form.targetProfitPct} onChange={f("targetProfitPct")} placeholder="50"
                className="w-full bg-secondary border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring font-mono-num" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wide block mb-1">Entry Time (IST)</label>
              <input type="time" value={form.entryTimeIst} onChange={f("entryTimeIst")}
                className="w-full bg-secondary border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wide block mb-1">Exit Time (IST)</label>
              <input type="time" value={form.exitTimeIst} onChange={f("exitTimeIst")}
                className="w-full bg-secondary border border-input rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring" />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={createStrategy.isPending}
              className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:opacity-90 disabled:opacity-50">
              {createStrategy.isPending ? "Creating..." : "Create Strategy"}
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded text-sm hover:opacity-80">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Strategies() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [executing, setExecuting] = useState<number | null>(null);

  const { data: strategies, isLoading } = useListStrategies({
    query: { queryKey: getListStrategiesQueryKey(), refetchInterval: 30000 },
  });

  const toggleStrategy = useToggleStrategy({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getListStrategiesQueryKey() }) },
  });

  const executeStrategy = useExecuteStrategy({
    mutation: {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListStrategiesQueryKey() });
        setExecuting(null);
      },
      onError: () => setExecuting(null),
    },
  });

  const deleteStrategy = useDeleteStrategy({
    mutation: { onSuccess: () => qc.invalidateQueries({ queryKey: getListStrategiesQueryKey() }) },
  });

  return (
    <div className="p-6">
      {showCreate && <CreateStrategyModal onClose={() => setShowCreate(false)} />}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Strategies</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Configure and execute automated option strategies</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded font-medium hover:opacity-90 transition-opacity"
        >
          <Plus size={14} />
          New Strategy
        </button>
      </div>

      {isLoading && (
        <div className="text-center py-12 text-muted-foreground text-sm">Loading strategies...</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {(strategies ?? []).map((strategy) => (
          <div key={strategy.id} className="bg-card border border-card-border rounded-md p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="font-semibold text-sm text-foreground">{strategy.name}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {STRATEGY_LABELS[strategy.strategyType as StrategyType]} · {strategy.underlying} · {strategy.frequency}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => toggleStrategy.mutate({ id: strategy.id })}
                  className={`transition-colors ${strategy.isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                  title={strategy.isActive ? "Disable auto-execute" : "Enable auto-execute"}
                >
                  {strategy.isActive ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                </button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground mb-4">
              {STRATEGY_DESC[strategy.strategyType as StrategyType]}
            </p>

            <div className="grid grid-cols-3 gap-3 mb-4">
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Total P&L</div>
                <PnlBadge value={strategy.totalPnl} />
              </div>
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Trades</div>
                <div className="font-mono-num text-sm font-medium">{strategy.totalTradesPlaced}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Lots</div>
                <div className="font-mono-num text-sm font-medium">{strategy.lotMultiplier}x</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground mb-4">
              {strategy.wingWidth && <div>Wing: <span className="text-foreground font-mono-num">{strategy.wingWidth} pts</span></div>}
              {strategy.stopLossPct && <div>SL: <span className="text-foreground font-mono-num">{strategy.stopLossPct}%</span></div>}
              {strategy.targetProfitPct && <div>TP: <span className="text-foreground font-mono-num">{strategy.targetProfitPct}%</span></div>}
              {strategy.deltaTarget && <div>Delta: <span className="text-foreground font-mono-num">{strategy.deltaTarget}</span></div>}
              {strategy.entryTimeIst && <div>Entry: <span className="text-foreground font-mono-num">{strategy.entryTimeIst} IST</span></div>}
              {strategy.exitTimeIst && <div>Exit: <span className="text-foreground font-mono-num">{strategy.exitTimeIst} IST</span></div>}
            </div>

            {strategy.lastExecutedAt && (
              <div className="text-xs text-muted-foreground mb-3">
                Last run: {new Date(strategy.lastExecutedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false })} IST
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setExecuting(strategy.id);
                  executeStrategy.mutate({ id: strategy.id });
                }}
                disabled={executing === strategy.id}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary/10 text-primary rounded hover:bg-primary/20 transition-colors font-medium disabled:opacity-50"
              >
                <Play size={11} />
                {executing === strategy.id ? "Executing..." : "Execute Now"}
              </button>
              <span className={`text-xs px-2 py-1 rounded ${strategy.isActive ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                {strategy.isActive ? "Auto: ON" : "Auto: OFF"}
              </span>
              <button
                onClick={() => deleteStrategy.mutate({ id: strategy.id })}
                className="ml-auto p-1.5 text-muted-foreground hover:text-destructive transition-colors"
                title="Delete strategy"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}

        {!isLoading && (strategies ?? []).length === 0 && (
          <div className="col-span-2 py-12 text-center">
            <div className="text-muted-foreground text-sm mb-4">No strategies configured yet.</div>
            <button
              onClick={() => setShowCreate(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium"
            >
              Create Your First Strategy
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
