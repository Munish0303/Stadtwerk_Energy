// Day-ahead arbitrage for a battery storage system, solved exactly with dynamic programming
// over a discretised state of charge. Perfect foresight → an upper bound on spot revenue.

import { berlinParts } from "./time";

export type BatteryParams = {
  capacityMWh: number;
  powerMW: number;
  /** round-trip efficiency, 0…1 */
  rte: number;
  /** degradation cost per MWh discharged, €/MWh */
  cycleCost: number;
  /** start = end state of charge, 0…1 */
  socStart: number;
};

export type BatteryStep = {
  t: number;
  price: number;
  /** grid power, MW: + charging, − discharging */
  gridMW: number;
  /** state of charge after this hour, % */
  soc: number;
  cash: number;
};

export type BatteryResult = {
  steps: BatteryStep[];
  revenue: number;
  energyCharged: number;
  energyDischarged: number;
  cycles: number;
  avgBuy: number;
  avgSell: number;
  daily: { date: string; t: number; revenue: number }[];
};

export function optimizeBattery(prices: { t: number; price: number }[], p: BatteryParams, levels = 60): BatteryResult {
  const T = prices.length;
  const S = levels;
  const unit = p.capacityMWh / S; // MWh stored per level
  const maxMove = Math.max(1, Math.min(S, Math.floor(p.powerMW / unit + 1e-9)));
  const eta = Math.sqrt(Math.max(0.01, Math.min(1, p.rte)));
  const s0 = Math.round(Math.max(0, Math.min(1, p.socStart)) * S);

  const cashFor = (price: number, d: number) =>
    d > 0 ? (-price * d) / eta : d < 0 ? -d * eta * (price - p.cycleCost) : 0;

  // V[i][s] = best cash from hour i onwards starting at level s, ending at s0.
  const V: Float64Array[] = Array.from({ length: T + 1 }, () => new Float64Array(S + 1).fill(-Infinity));
  const policy: Int16Array[] = Array.from({ length: T }, () => new Int16Array(S + 1));
  V[T][s0] = 0;

  for (let i = T - 1; i >= 0; i--) {
    const price = prices[i].price;
    for (let s = 0; s <= S; s++) {
      let best = -Infinity;
      let arg = s;
      const lo = Math.max(0, s - maxMove);
      const hi = Math.min(S, s + maxMove);
      for (let s2 = lo; s2 <= hi; s2++) {
        const future = V[i + 1][s2];
        if (future === -Infinity) continue;
        const v = cashFor(price, (s2 - s) * unit) + future;
        if (v > best) {
          best = v;
          arg = s2;
        }
      }
      V[i][s] = best;
      policy[i][s] = arg;
    }
  }

  const steps: BatteryStep[] = [];
  let s = s0;
  let charged = 0;
  let discharged = 0;
  let buyCost = 0;
  let sellRev = 0;
  for (let i = 0; i < T; i++) {
    const s2 = policy[i][s];
    const d = (s2 - s) * unit;
    const price = prices[i].price;
    const cash = cashFor(price, d);
    let gridMW = 0;
    if (d > 0) {
      gridMW = d / eta;
      charged += gridMW;
      buyCost += gridMW * price;
    } else if (d < 0) {
      gridMW = d * eta;
      discharged += -gridMW;
      sellRev += -gridMW * price;
    }
    steps.push({ t: prices[i].t, price, gridMW, soc: (s2 / S) * 100, cash });
    s = s2;
  }

  const dailyMap = new Map<string, { t: number; revenue: number }>();
  steps.forEach((st) => {
    const date = berlinParts(st.t).date;
    const d = dailyMap.get(date) ?? { t: st.t, revenue: 0 };
    d.revenue += st.cash;
    dailyMap.set(date, d);
  });

  return {
    steps,
    revenue: steps.reduce((a, x) => a + x.cash, 0),
    energyCharged: charged,
    energyDischarged: discharged,
    cycles: discharged / eta / p.capacityMWh,
    avgBuy: charged ? buyCost / charged : NaN,
    avgSell: discharged ? sellRev / discharged : NaN,
    daily: [...dailyMap].map(([date, v]) => ({ date, ...v })),
  };
}
