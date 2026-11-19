// Short-term load forecasting for a distribution grid / supply portfolio.
// Model: ridge regression on hour-of-week profile (holidays treated as Sundays)
// + heating/cooling degree hours. Fast enough to run in the browser on 2 years of hourly data.

import { solve } from "./linalg";
import { berlinParts, HOUR } from "./time";
import { gaussian, mape, mean, quantile, rmse, seededRandom, std } from "./stats";

export type Pt = { t: number; v: number };

// ---------- calendar ----------

function easter(year: number): [number, number] {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

const holidayCache = new Map<number, Set<string>>();

/** Public holidays in North Rhine-Westphalia. */
export function holidaysNRW(year: number): Set<string> {
  const hit = holidayCache.get(year);
  if (hit) return hit;
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const [em, ed] = easter(year);
  const e = Date.UTC(year, em - 1, ed);
  const D = 86_400_000;
  const set = new Set<string>([
    `${year}-01-01`,
    iso(e - 2 * D), // Karfreitag
    iso(e + 1 * D), // Ostermontag
    `${year}-05-01`,
    iso(e + 39 * D), // Christi Himmelfahrt
    iso(e + 50 * D), // Pfingstmontag
    iso(e + 60 * D), // Fronleichnam
    `${year}-10-03`,
    `${year}-11-01`,
    `${year}-12-24`, // not official, but load behaves like a holiday
    `${year}-12-25`,
    `${year}-12-26`,
    `${year}-12-31`,
  ]);
  holidayCache.set(year, set);
  return set;
}

const isHoliday = (date: string) => holidaysNRW(Number(date.slice(0, 4))).has(date);

// ---------- features ----------

const NHOW = 168;
const NFEAT = NHOW + 3;
export const HEAT_BASE = 15;
export const COOL_BASE = 22;

type Row = { k: number; d0: number; d1: number; d2: number };

function features(t: number, temp: number): Row {
  const p = berlinParts(t);
  const dow = isHoliday(p.date) ? 6 : p.dow;
  const hdd = Math.max(0, HEAT_BASE - temp);
  const cdd = Math.max(0, temp - COOL_BASE);
  const daytime = p.hour >= 7 && p.hour <= 21 ? 1 : 0;
  return { k: dow * 24 + p.hour, d0: hdd, d1: cdd, d2: hdd * daytime };
}

function fit(rows: Row[], y: number[], lambda = 1e-3): Float64Array {
  const A = Array.from({ length: NFEAT }, () => new Float64Array(NFEAT));
  const b = new Float64Array(NFEAT);
  const idx = [0, NHOW, NHOW + 1, NHOW + 2];
  const val = [1, 0, 0, 0];
  for (let r = 0; r < rows.length; r++) {
    const f = rows[r];
    idx[0] = f.k;
    val[1] = f.d0;
    val[2] = f.d1;
    val[3] = f.d2;
    for (let i = 0; i < 4; i++) {
      b[idx[i]] += val[i] * y[r];
      for (let j = 0; j < 4; j++) A[idx[i]][idx[j]] += val[i] * val[j];
    }
  }
  for (let i = 0; i < NFEAT; i++) A[i][i] += lambda;
  return solve(A, b);
}

const predict = (f: Row, beta: Float64Array) =>
  beta[f.k] + beta[NHOW] * f.d0 + beta[NHOW + 1] * f.d1 + beta[NHOW + 2] * f.d2;

/** Nearest-neighbour temperature lookup with linear interpolation. */
function tempLookup(temps: Pt[]): (t: number) => number {
  if (!temps.length) return () => 10;
  const ts = temps.map((x) => x.t);
  return (t: number) => {
    let lo = 0;
    let hi = ts.length - 1;
    if (t <= ts[0]) return temps[0].v;
    if (t >= ts[hi]) return temps[hi].v;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (ts[mid] <= t) lo = mid;
      else hi = mid;
    }
    const w = (t - ts[lo]) / (ts[hi] - ts[lo] || 1);
    return temps[lo].v * (1 - w) + temps[hi].v * w;
  };
}

// ---------- public API ----------

export function resampleHourly(points: Pt[]): Pt[] {
  const acc = new Map<number, { s: number; n: number }>();
  points.forEach(({ t, v }) => {
    const k = Math.floor(t / HOUR) * HOUR;
    const a = acc.get(k) ?? { s: 0, n: 0 };
    a.s += v;
    a.n += 1;
    acc.set(k, a);
  });
  return [...acc].sort((a, b) => a[0] - b[0]).map(([t, a]) => ({ t, v: a.s / a.n }));
}

export type LoadAnalysis = {
  kpis: {
    peak: number;
    peakTime: number;
    base: number;
    avg: number;
    loadFactor: number;
    energy: number;
    hours: number;
    days: number;
  };
  metrics: { mape: number; naiveMape: number; skill: number; rmse: number; holdoutHours: number; naiveLag: number };
  heatSlope: number;
  coolSlope: number;
  holdout: { t: number; actual: number; model: number; naive: number | null }[];
  history: { t: number; actual: number; fitted: number }[];
  forecast: { t: number; pred: number; band: [number, number]; temp: number }[];
  anomalies: { t: number; actual: number; expected: number; z: number }[];
  heatmap: number[][];
  daily: { date: string; load: number; temp: number }[];
  residualStd: number;
};

export function analyzeLoad(series: Pt[], temps: Pt[], horizonHours = 168): LoadAnalysis {
  const tempAt = tempLookup(temps);
  const n = series.length;
  const ys = series.map((p) => p.v);
  const rows = series.map((p) => features(p.t, tempAt(p.t)));
  const byT = new Map(series.map((p) => [p.t, p.v]));

  // --- descriptive KPIs ---
  let peakIdx = 0;
  ys.forEach((v, i) => {
    if (v > ys[peakIdx]) peakIdx = i;
  });
  const avg = mean(ys);
  const kpis = {
    peak: ys[peakIdx],
    peakTime: series[peakIdx].t,
    base: quantile(ys, 0.05),
    avg,
    loadFactor: avg / ys[peakIdx],
    energy: ys.reduce((a, b) => a + b, 0), // unit·h
    hours: n,
    days: n / 24,
  };

  // --- backtest on the most recent week vs seasonal-naive ---
  const holdoutHours = n >= 28 * 24 ? 168 : 48;
  const cut = n - holdoutHours;
  const betaTrain = fit(rows.slice(0, cut), ys.slice(0, cut));
  const naiveLag = n >= 28 * 24 ? 168 : 24;
  const holdout = series.slice(cut).map((p, i) => ({
    t: p.t,
    actual: p.v,
    model: predict(rows[cut + i], betaTrain),
    naive: byT.get(p.t - naiveLag * HOUR) ?? null,
  }));
  const hModel = holdout.map((h) => h.model);
  const hActual = holdout.map((h) => h.actual);
  const withNaive = holdout.filter((h) => h.naive !== null);
  const mModel = mape(hActual, hModel);
  const mNaive = mape(
    withNaive.map((h) => h.actual),
    withNaive.map((h) => h.naive as number),
  );

  // --- full refit, residual diagnostics ---
  const beta = fit(rows, ys);
  const fitted = rows.map((r) => predict(r, beta));
  const resid = ys.map((y, i) => y - fitted[i]);
  const sigma = std(resid) || 1;
  const anomalies = series
    .map((p, i) => ({ t: p.t, actual: p.v, expected: fitted[i], z: resid[i] / sigma }))
    .filter((a) => Math.abs(a.z) >= 3)
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
    .slice(0, 15);

  // --- forecast ---
  const lastT = series[n - 1].t;
  const forecast = Array.from({ length: horizonHours }, (_, i) => {
    const t = lastT + (i + 1) * HOUR;
    const temp = tempAt(t);
    const pred = predict(features(t, temp), beta);
    const spread = 1.28 * sigma * Math.sqrt(1 + i / 168); // ~80% band, widening with horizon
    return { t, pred, band: [pred - spread, pred + spread] as [number, number], temp };
  });

  // --- weekday × hour heatmap ---
  const sums = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const cnts = Array.from({ length: 7 }, () => new Array(24).fill(0));
  series.forEach((p) => {
    const bp = berlinParts(p.t);
    sums[bp.dow][bp.hour] += p.v;
    cnts[bp.dow][bp.hour] += 1;
  });
  const heatmap = sums.map((row, d) => row.map((s, h) => (cnts[d][h] ? s / cnts[d][h] : NaN)));

  // --- daily load vs temperature ---
  const dmap = new Map<string, { l: number; tt: number; c: number }>();
  series.forEach((p) => {
    const date = berlinParts(p.t).date;
    const a = dmap.get(date) ?? { l: 0, tt: 0, c: 0 };
    a.l += p.v;
    a.tt += tempAt(p.t);
    a.c += 1;
    dmap.set(date, a);
  });
  const daily = [...dmap]
    .filter(([, a]) => a.c >= 20)
    .map(([date, a]) => ({ date, load: a.l / a.c, temp: a.tt / a.c }));

  return {
    kpis,
    metrics: {
      mape: mModel,
      naiveMape: mNaive,
      skill: Number.isFinite(mNaive) && mNaive > 0 ? 1 - mModel / mNaive : NaN,
      rmse: rmse(hActual, hModel),
      holdoutHours,
      naiveLag,
    },
    heatSlope: beta[NHOW] + beta[NHOW + 2] * (15 / 24), // avg effect per K below 15 °C
    coolSlope: beta[NHOW + 1],
    holdout,
    history: series.map((p, i) => ({ t: p.t, actual: p.v, fitted: fitted[i] })),
    forecast,
    anomalies,
    heatmap,
    daily,
    residualStd: sigma,
  };
}

// ---------- synthetic sample ----------

const WEEKDAY = [0.6, 0.57, 0.55, 0.55, 0.57, 0.64, 0.79, 0.91, 0.96, 0.97, 0.98, 1.0, 0.99, 0.97, 0.95, 0.94, 0.95, 0.98, 1.0, 0.98, 0.91, 0.83, 0.74, 0.66];
const SATURDAY = [0.62, 0.58, 0.56, 0.55, 0.55, 0.57, 0.63, 0.71, 0.79, 0.85, 0.88, 0.89, 0.88, 0.85, 0.82, 0.8, 0.81, 0.86, 0.9, 0.89, 0.84, 0.78, 0.71, 0.65];
const SUNDAY = [0.6, 0.56, 0.54, 0.53, 0.52, 0.53, 0.56, 0.61, 0.67, 0.73, 0.77, 0.79, 0.78, 0.74, 0.71, 0.7, 0.72, 0.79, 0.85, 0.85, 0.8, 0.74, 0.68, 0.62];

/**
 * Hourly grid load (MW) of a mid-sized municipal utility (~150k inhabitants), driven by real
 * temperatures, with AR(1) noise and three injected events the anomaly detector should find.
 */
export function generateSampleLoad(temps: Pt[], until: number, seed = 11): Pt[] {
  const rng = seededRandom(seed);
  const hist = temps.filter((p) => p.t <= until);
  let ar = 0;
  const out: Pt[] = hist.map((p) => {
    const bp = berlinParts(p.t);
    const dow = isHoliday(bp.date) ? 6 : bp.dow;
    const shape = dow === 6 ? SUNDAY : dow === 5 ? SATURDAY : WEEKDAY;
    const hdd = Math.max(0, HEAT_BASE - p.v);
    const cdd = Math.max(0, p.v - COOL_BASE);
    ar = 0.85 * ar + gaussian(rng) * 0.45;
    const v = 62 * shape[bp.hour] + 0.75 * hdd * (bp.hour >= 6 && bp.hour <= 22 ? 1.15 : 0.7) + 0.9 * cdd + ar;
    return { t: p.t, v };
  });
  const N = out.length;
  const event = (hoursAgo: number, len: number, delta: number) => {
    for (let i = 0; i < len; i++) {
      const j = N - hoursAgo + i;
      if (j >= 0 && j < N) out[j] = { t: out[j].t, v: out[j].v + delta };
    }
  };
  event(24 * 23 + 14, 3, 13); // industrial customer test run
  event(24 * 12 + 6, 2, -17); // feeder outage
  event(24 * 4 + 10, 1, 11); // metering spike
  return out;
}
