import { useState } from "react";

const UNDERLYING_LTP = 23719.3;
const ATM_STRIKE = 23700;

const EXPIRIES = [
  { date: "26-05-2026", label: "26 May", flag: "M" },
  { date: "02-06-2026", label: "02 Jun", flag: "W" },
  { date: "09-06-2026", label: "09 Jun", flag: "W" },
  { date: "16-06-2026", label: "16 Jun", flag: "W" },
  { date: "23-06-2026", label: "23 Jun", flag: "W" },
  { date: "30-06-2026", label: "30 Jun", flag: "M" },
];

const CHAIN: Record<string, { strike: number; call_ltp: number; call_oi: number; call_volume: number; put_ltp: number; put_oi: number; put_volume: number }[]> = {
  "26-05-2026": [
    { strike: 23200, call_ltp: 589.65, call_oi: 276770, call_volume: 894205, put_ltp: 11.85, put_oi: 4394000, put_volume: 55520465 },
    { strike: 23300, call_ltp: 495.10, call_oi: 517725, call_volume: 1439750, put_ltp: 18.30, put_oi: 5807295, put_volume: 80257905 },
    { strike: 23400, call_ltp: 408.60, call_oi: 1155115, call_volume: 5072210, put_ltp: 29.00, put_oi: 5014165, put_volume: 88615150 },
    { strike: 23500, call_ltp: 324.65, call_oi: 2727920, call_volume: 25344995, put_ltp: 44.85, put_oi: 8769865, put_volume: 161728320 },
    { strike: 23600, call_ltp: 246.75, call_oi: 2428075, call_volume: 55198715, put_ltp: 68.85, put_oi: 5220345, put_volume: 164775520 },
    { strike: 23650, call_ltp: 213.55, call_oi: 1042210, call_volume: 52487825, put_ltp: 85.25, put_oi: 2389725, put_volume: 124711470 },
    { strike: 23700, call_ltp: 182.70, call_oi: 4821180, call_volume: 203368945, put_ltp: 103.75, put_oi: 6203340, put_volume: 270060505 },
    { strike: 23750, call_ltp: 153.70, call_oi: 2671565, call_volume: 188325930, put_ltp: 125.05, put_oi: 2837770, put_volume: 200768425 },
    { strike: 23800, call_ltp: 128.40, call_oi: 7213830, call_volume: 331429735, put_ltp: 149.10, put_oi: 4395040, put_volume: 256472515 },
    { strike: 23900, call_ltp: 87.45, call_oi: 4269720, call_volume: 173269655, put_ltp: 207.80, put_oi: 997100, put_volume: 52109070 },
    { strike: 24000, call_ltp: 58.65, call_oi: 12853945, call_volume: 242542495, put_ltp: 277.75, put_oi: 3197870, put_volume: 29333720 },
    { strike: 24100, call_ltp: 38.60, call_oi: 4073680, call_volume: 105892605, put_ltp: 356.75, put_oi: 681915, put_volume: 3761485 },
    { strike: 24200, call_ltp: 25.40, call_oi: 5647460, call_volume: 109080920, put_ltp: 445.35, put_oi: 798460, put_volume: 2265965 },
    { strike: 24300, call_ltp: 17.20, call_oi: 5407090, call_volume: 63805300, put_ltp: 537.65, put_oi: 958425, put_volume: 935415 },
    { strike: 24500, call_ltp: 8.55, call_oi: 10900630, call_volume: 60896095, put_ltp: 728.00, put_oi: 2402335, put_volume: 1040325 },
  ],
  "02-06-2026": [
    { strike: 23000, call_ltp: 835.60, call_oi: 83135, call_volume: 85215, put_ltp: 38.25, put_oi: 1066195, put_volume: 3933670 },
    { strike: 23300, call_ltp: 614.80, call_oi: 47580, call_volume: 156890, put_ltp: 60.40, put_oi: 821145, put_volume: 7435190 },
    { strike: 23500, call_ltp: 453.40, call_oi: 191685, call_volume: 1403720, put_ltp: 97.60, put_oi: 2092720, put_volume: 20047575 },
    { strike: 23700, call_ltp: 307.75, call_oi: 556985, call_volume: 7099745, put_ltp: 151.35, put_oi: 1716870, put_volume: 29620665 },
    { strike: 23800, call_ltp: 249.20, call_oi: 635520, call_volume: 9765505, put_ltp: 189.70, put_oi: 936125, put_volume: 19461750 },
    { strike: 24000, call_ltp: 153.65, call_oi: 917610, call_volume: 8754830, put_ltp: 289.35, put_oi: 660135, put_volume: 5914320 },
    { strike: 24200, call_ltp: 88.15, call_oi: 568725, call_volume: 3451290, put_ltp: 418.50, put_oi: 218785, put_volume: 869635 },
    { strike: 24500, call_ltp: 39.40, call_oi: 749115, call_volume: 2071490, put_ltp: 655.00, put_oi: 318710, put_volume: 182430 },
  ],
  "09-06-2026": [
    { strike: 23500, call_ltp: 532.10, call_oi: 89765, call_volume: 654320, put_ltp: 127.40, put_oi: 987450, put_volume: 9876540 },
    { strike: 23700, call_ltp: 391.45, call_oi: 234560, call_volume: 3456780, put_ltp: 183.20, put_oi: 876540, put_volume: 14567890 },
    { strike: 24000, call_ltp: 223.80, call_oi: 456780, call_volume: 4567890, put_ltp: 315.60, put_oi: 345670, put_volume: 2345670 },
    { strike: 24200, call_ltp: 143.50, call_oi: 234560, call_volume: 1234560, put_ltp: 431.90, put_oi: 123456, put_volume: 456780 },
    { strike: 24500, call_ltp: 72.30, call_oi: 345670, call_volume: 890123, put_ltp: 654.20, put_oi: 145678, put_volume: 90123 },
  ],
  "16-06-2026": [
    { strike: 23500, call_ltp: 598.20, call_oi: 67890, call_volume: 456780, put_ltp: 153.80, put_oi: 765430, put_volume: 7654300 },
    { strike: 23700, call_ltp: 455.30, call_oi: 189540, call_volume: 2345670, put_ltp: 208.40, put_oi: 654320, put_volume: 10987650 },
    { strike: 24000, call_ltp: 270.90, call_oi: 345670, call_volume: 3456780, put_ltp: 345.70, put_oi: 234560, put_volume: 1765430 },
    { strike: 24500, call_ltp: 95.60, call_oi: 234560, call_volume: 678900, put_ltp: 660.40, put_oi: 98765, put_volume: 67890 },
  ],
  "23-06-2026": [
    { strike: 23500, call_ltp: 645.80, call_oi: 54320, call_volume: 345670, put_ltp: 178.20, put_oi: 543210, put_volume: 5432100 },
    { strike: 23700, call_ltp: 508.60, call_oi: 143210, call_volume: 1765430, put_ltp: 232.50, put_oi: 432100, put_volume: 7654300 },
    { strike: 24000, call_ltp: 316.40, call_oi: 265430, call_volume: 2345670, put_ltp: 378.90, put_oi: 176540, put_volume: 1234560 },
    { strike: 24500, call_ltp: 118.70, call_oi: 176540, call_volume: 456780, put_ltp: 666.30, put_oi: 76540, put_volume: 45678 },
  ],
  "30-06-2026": [
    { strike: 23500, call_ltp: 689.30, call_oi: 43210, call_volume: 265430, put_ltp: 198.60, put_oi: 432100, put_volume: 4321000 },
    { strike: 23700, call_ltp: 554.10, call_oi: 112340, call_volume: 1345670, put_ltp: 254.30, put_oi: 321000, put_volume: 5678900 },
    { strike: 24000, call_ltp: 358.20, call_oi: 198760, call_volume: 1876540, put_ltp: 408.70, put_oi: 143210, put_volume: 987650 },
    { strike: 24500, call_ltp: 139.80, call_oi: 143210, call_volume: 345670, put_ltp: 671.40, put_oi: 65430, put_volume: 34567 },
  ],
};

type BasketLeg = {
  id: string;
  strike: number;
  type: "CE" | "PE";
  action: "BUY" | "SELL";
  ltp: number;
  lots: number;
  lotSize: number;
};

function fmt(n: number) { return n.toLocaleString("en-IN"); }
function fmtOi(n: number) {
  if (n >= 10000000) return (n / 10000000).toFixed(1) + "Cr";
  if (n >= 100000) return (n / 100000).toFixed(1) + "L";
  if (n >= 1000) return (n / 1000).toFixed(0) + "K";
  return n.toString();
}

export function OptionChainBuilder() {
  const [selectedExpiry, setSelectedExpiry] = useState("26-05-2026");
  const [basket, setBasket] = useState<BasketLeg[]>([]);
  const [strategyName, setStrategyName] = useState("My Iron Condor");
  const [showSuccess, setShowSuccess] = useState(false);

  const chain = CHAIN[selectedExpiry] ?? [];

  function addToBasket(strike: number, type: "CE" | "PE", ltp: number, action: "BUY" | "SELL") {
    const id = `${strike}-${type}-${action}`;
    if (basket.find(b => b.id === id)) return;
    setBasket(prev => [...prev, { id, strike, type, action, ltp, lots: 1, lotSize: 75 }]);
  }

  function removeFromBasket(id: string) {
    setBasket(prev => prev.filter(b => b.id !== id));
  }

  function toggleAction(id: string) {
    setBasket(prev => prev.map(b => b.id === id ? { ...b, action: b.action === "BUY" ? "SELL" : "BUY" } : b));
  }

  function setLots(id: string, lots: number) {
    setBasket(prev => prev.map(b => b.id === id ? { ...b, lots: Math.max(1, lots) } : b));
  }

  const totalPremium = basket.reduce((sum, b) => {
    const sign = b.action === "SELL" ? 1 : -1;
    return sum + sign * b.ltp * b.lots * b.lotSize;
  }, 0);

  function createStrategy() {
    setShowSuccess(true);
    setTimeout(() => { setShowSuccess(false); setBasket([]); }, 2500);
  }

  const isInBasket = (strike: number, type: "CE" | "PE") =>
    basket.some(b => b.strike === strike && b.type === type);

  return (
    <div className="min-h-screen bg-[#0f1117] text-gray-100 font-sans flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-800 px-5 py-3 flex items-center gap-4 bg-[#141720]">
        <div>
          <span className="text-xs text-gray-500 uppercase tracking-wider">Symbol</span>
          <div className="font-semibold text-white">NSE:NIFTY50</div>
        </div>
        <div className="h-8 w-px bg-gray-700" />
        <div>
          <span className="text-xs text-gray-500">Spot</span>
          <div className="font-mono font-bold text-white text-lg">{fmt(UNDERLYING_LTP)}</div>
        </div>
        <div className="h-8 w-px bg-gray-700" />
        <div>
          <span className="text-xs text-gray-500">ATM</span>
          <div className="font-mono font-bold text-cyan-400">{fmt(ATM_STRIKE)}</div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-500">Lot Size:</span>
          <span className="text-xs font-mono font-semibold text-white bg-gray-800 px-2 py-0.5 rounded">75</span>
        </div>
      </div>

      {/* Expiry selector */}
      <div className="border-b border-gray-800 px-5 py-2 flex items-center gap-1 bg-[#141720]">
        <span className="text-xs text-gray-500 mr-2">Expiry:</span>
        {EXPIRIES.map(exp => (
          <button
            key={exp.date}
            onClick={() => setSelectedExpiry(exp.date)}
            className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-all ${
              selectedExpiry === exp.date
                ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
            }`}
          >
            {exp.label}
            <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${
              exp.flag === "M" ? "bg-orange-500/30 text-orange-400" : "bg-blue-500/30 text-blue-400"
            }`}>{exp.flag}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Option Chain Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs border-collapse">
            <thead className="sticky top-0 bg-[#141720] z-10">
              <tr>
                <th colSpan={4} className="py-2 text-center text-cyan-400 font-semibold border-b border-r border-gray-800 text-xs">CALLS</th>
                <th className="py-2 px-3 text-center font-bold text-gray-200 border-b border-gray-800 text-xs">STRIKE</th>
                <th colSpan={4} className="py-2 text-center text-red-400 font-semibold border-b border-l border-gray-800 text-xs">PUTS</th>
              </tr>
              <tr className="text-gray-500 text-[10px] uppercase tracking-wider">
                <th className="px-2 py-1.5 text-right border-b border-gray-800">OI</th>
                <th className="px-2 py-1.5 text-right border-b border-gray-800">Vol</th>
                <th className="px-2 py-1.5 text-right border-b border-r border-gray-800">LTP</th>
                <th className="px-2 py-1.5 text-center border-b border-r border-gray-800">Add</th>
                <th className="px-3 py-1.5 text-center font-bold text-gray-300 border-b border-gray-800">Strike</th>
                <th className="px-2 py-1.5 text-center border-b border-l border-gray-800">Add</th>
                <th className="px-2 py-1.5 text-left border-b border-gray-800">LTP</th>
                <th className="px-2 py-1.5 text-left border-b border-gray-800">Vol</th>
                <th className="px-2 py-1.5 text-left border-b border-gray-800">OI</th>
              </tr>
            </thead>
            <tbody>
              {chain.map(row => {
                const isAtm = row.strike === ATM_STRIKE;
                const ceInBasket = isInBasket(row.strike, "CE");
                const peInBasket = isInBasket(row.strike, "PE");
                return (
                  <tr
                    key={row.strike}
                    className={`border-b border-gray-800/50 ${isAtm ? "bg-cyan-950/30" : "hover:bg-gray-800/20"}`}
                  >
                    {/* Call OI */}
                    <td className="px-2 py-2 text-right font-mono text-gray-400">{fmtOi(row.call_oi)}</td>
                    {/* Call Vol */}
                    <td className="px-2 py-2 text-right font-mono text-gray-400">{fmtOi(row.call_volume)}</td>
                    {/* Call LTP */}
                    <td className={`px-2 py-2 text-right font-mono font-medium border-r border-gray-800 ${isAtm ? "text-cyan-300" : "text-cyan-400"}`}>
                      {row.call_ltp.toFixed(2)}
                    </td>
                    {/* CE Add button */}
                    <td className="px-2 py-2 text-center border-r border-gray-800">
                      <div className="flex gap-1 justify-center">
                        <button
                          onClick={() => addToBasket(row.strike, "CE", row.call_ltp, "SELL")}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${
                            ceInBasket ? "bg-red-600 text-white" : "bg-red-900/40 text-red-400 hover:bg-red-800/60"
                          }`}
                          title="Sell CE"
                        >S</button>
                        <button
                          onClick={() => addToBasket(row.strike, "CE", row.call_ltp, "BUY")}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${
                            ceInBasket ? "bg-green-600 text-white" : "bg-green-900/40 text-green-400 hover:bg-green-800/60"
                          }`}
                          title="Buy CE"
                        >B</button>
                      </div>
                    </td>
                    {/* Strike */}
                    <td className={`px-3 py-2 text-center font-mono font-bold ${isAtm ? "text-cyan-300" : "text-gray-200"}`}>
                      {fmt(row.strike)}
                      {isAtm && <span className="ml-1 text-[9px] text-cyan-500 font-normal">ATM</span>}
                    </td>
                    {/* PE Add button */}
                    <td className="px-2 py-2 text-center border-l border-gray-800">
                      <div className="flex gap-1 justify-center">
                        <button
                          onClick={() => addToBasket(row.strike, "PE", row.put_ltp, "SELL")}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${
                            peInBasket ? "bg-red-600 text-white" : "bg-red-900/40 text-red-400 hover:bg-red-800/60"
                          }`}
                          title="Sell PE"
                        >S</button>
                        <button
                          onClick={() => addToBasket(row.strike, "PE", row.put_ltp, "BUY")}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold transition-all ${
                            peInBasket ? "bg-green-600 text-white" : "bg-green-900/40 text-green-400 hover:bg-green-800/60"
                          }`}
                          title="Buy PE"
                        >B</button>
                      </div>
                    </td>
                    {/* Put LTP */}
                    <td className={`px-2 py-2 text-left font-mono font-medium ${isAtm ? "text-red-300" : "text-red-400"}`}>
                      {row.put_ltp.toFixed(2)}
                    </td>
                    {/* Put Vol */}
                    <td className="px-2 py-2 text-left font-mono text-gray-400">{fmtOi(row.put_volume)}</td>
                    {/* Put OI */}
                    <td className="px-2 py-2 text-left font-mono text-gray-400">{fmtOi(row.put_oi)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Basket Panel */}
        <div className="w-72 border-l border-gray-800 bg-[#141720] flex flex-col">
          <div className="px-4 py-3 border-b border-gray-800">
            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Strategy Name</div>
            <input
              value={strategyName}
              onChange={e => setStrategyName(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500"
            />
          </div>

          <div className="px-3 py-2 text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800 flex items-center justify-between">
            <span>Basket ({basket.length} legs)</span>
            {basket.length > 0 && (
              <button onClick={() => setBasket([])} className="text-gray-600 hover:text-red-400 text-xs">Clear</button>
            )}
          </div>

          <div className="flex-1 overflow-auto">
            {basket.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-600 px-4 text-center">
                <div className="text-3xl">📋</div>
                <div className="text-xs">Click B (Buy) or S (Sell) next to any strike to add legs</div>
              </div>
            ) : (
              <div className="divide-y divide-gray-800">
                {basket.map(leg => (
                  <div key={leg.id} className="px-3 py-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => toggleAction(leg.id)}
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            leg.action === "SELL"
                              ? "bg-red-600/30 text-red-400 border border-red-600/40"
                              : "bg-green-600/30 text-green-400 border border-green-600/40"
                          }`}
                        >
                          {leg.action}
                        </button>
                        <span className="text-xs font-mono font-semibold text-white">{fmt(leg.strike)}</span>
                        <span className={`text-[10px] px-1 py-0.5 rounded font-bold ${
                          leg.type === "CE" ? "bg-cyan-900/50 text-cyan-400" : "bg-red-900/50 text-red-400"
                        }`}>{leg.type}</span>
                      </div>
                      <button onClick={() => removeFromBasket(leg.id)} className="text-gray-600 hover:text-red-400 text-xs">✕</button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-gray-500">
                        LTP: <span className="text-gray-300 font-mono">{leg.ltp.toFixed(2)}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-gray-500">Lots:</span>
                        <button
                          onClick={() => setLots(leg.id, leg.lots - 1)}
                          className="w-5 h-5 rounded bg-gray-700 hover:bg-gray-600 text-xs flex items-center justify-center"
                        >−</button>
                        <span className="w-5 text-center text-xs font-mono text-white">{leg.lots}</span>
                        <button
                          onClick={() => setLots(leg.id, leg.lots + 1)}
                          className="w-5 h-5 rounded bg-gray-700 hover:bg-gray-600 text-xs flex items-center justify-center"
                        >+</button>
                      </div>
                    </div>
                    <div className="mt-1 text-[10px] text-gray-600">
                      Premium: <span className={leg.action === "SELL" ? "text-green-400" : "text-red-400"}>
                        {leg.action === "SELL" ? "+" : "−"}₹{(leg.ltp * leg.lots * leg.lotSize).toFixed(0)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-800 px-3 py-3 space-y-2">
            {basket.length > 0 && (
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-500">Net Premium</span>
                <span className={`font-mono font-bold ${totalPremium >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {totalPremium >= 0 ? "+" : ""}₹{totalPremium.toFixed(0)}
                </span>
              </div>
            )}
            <button
              onClick={createStrategy}
              disabled={basket.length === 0}
              className={`w-full py-2 rounded text-sm font-semibold transition-all ${
                basket.length === 0
                  ? "bg-gray-800 text-gray-600 cursor-not-allowed"
                  : "bg-cyan-600 hover:bg-cyan-500 text-white"
              }`}
            >
              {showSuccess ? "✓ Strategy Created!" : `Create Strategy (${basket.length} legs)`}
            </button>
            {basket.length > 0 && (
              <p className="text-[10px] text-gray-600 text-center">
                Expiry: {EXPIRIES.find(e => e.date === selectedExpiry)?.label} · NIFTY · {basket.length} legs
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
