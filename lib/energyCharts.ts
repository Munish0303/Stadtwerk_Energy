import "server-only";
import type { MarketData, MarketHour } from "./types";
import { addDays, berlinParts, floorHour, HOUR, todayBerlin } from "./time";
import { gaussian, seededRandom } from "./stats";

// Fraunhofer ISE Energy-Charts API (data: Bundesnetzagentur | SMARD.de, CC BY 4.0). No key needed.
const BASE = "https://api.energy-charts.info";

type PriceResp = { unix_seconds: number[]; price: (number | null)[] };
type PowerResp = {
  unix_seconds: number[];
  production_types: { name: string; data: (number | null)[] }[];
};

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    next: { revalidate: 900 },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return (await res.json()) as T;
}

/** Average a 15-minute series into hourly buckets keyed by hour-start (ms). */
function toHourly(unixSeconds: number[], values: (number | null)[], scale = 1): Map<number, number> {
  const acc = new Map<number, { s: number; n: number }>();
  unixSeconds.forEach((sec, i) => {
    const v = values[i];
    if (v === null || v === undefined || !Number.isFinite(v)) return;
    const k = floorHour(sec * 1000);
    const a = acc.get(k) ?? { s: 0, n: 0 };
    a.s += v * scale;
    a.n += 1;
    acc.set(k, a);
  });
  const out = new Map<number, number>();
  acc.forEach((a, k) => out.set(k, a.s / a.n));
  return out;
}

export async function getMarket(days = 7): Promise<MarketData> {
  const today = todayBerlin();
  const start = addDays(today, -(days - 1));
  const tomorrow = addDays(today, 1);

  const [priceRes, powerRes] = await Promise.allSettled([
    getJSON<PriceResp>(`${BASE}/price?bzn=DE-LU&start=${start}&end=${tomorrow}`),
    getJSON<PowerResp>(`${BASE}/public_power?country=de&start=${start}&end=${today}`),
  ]);

  if (priceRes.status === "rejected" && powerRes.status === "rejected") {
    return synthMarket(days, "Energy-Charts API unreachable — showing synthetic demo data.");
  }

  const price =
    priceRes.status === "fulfilled"
      ? toHourly(priceRes.value.unix_seconds, priceRes.value.price)
      : new Map<number, number>();

  const series: Record<string, Map<number, number>> = {};
  if (powerRes.status === "fulfilled") {
    const pick = (name: string, scale: number) => {
      const pt = powerRes.value.production_types.find((p) => p.name === name);
      return pt ? toHourly(powerRes.value.unix_seconds, pt.data, scale) : new Map<number, number>();
    };
    series.load = pick("Load", 1e-3);
    series.solar = pick("Solar", 1e-3);
    const on = pick("Wind onshore", 1e-3);
    const off = pick("Wind offshore", 1e-3);
    series.wind = new Map([...on].map(([k, v]) => [k, v + (off.get(k) ?? 0)]));
    series.residual = pick("Residual load", 1e-3);
    series.renShare = pick("Renewable share of load", 1);
  }

  const keys = new Set<number>([...price.keys()]);
  Object.values(series).forEach((m) => m.forEach((_, k) => keys.add(k)));
  const get = (m: Map<number, number> | undefined, k: number) => (m?.has(k) ? m.get(k)! : null);

  const hours: MarketHour[] = [...keys]
    .sort((a, b) => a - b)
    .map((t) => ({
      t,
      price: get(price, t),
      load: get(series.load, t),
      solar: get(series.solar, t),
      wind: get(series.wind, t),
      residual: get(series.residual, t),
      renShare: get(series.renShare, t),
    }));

  const failed = [
    priceRes.status === "rejected" ? "prices" : null,
    powerRes.status === "rejected" ? "generation" : null,
  ].filter(Boolean);

  return {
    source: "live",
    note: failed.length ? `Could not load ${failed.join(" & ")} from Energy-Charts.` : undefined,
    generatedAt: Date.now(),
    hours,
  };
}

/** Plausible German winter-ish market so the UI still works offline. */
function synthMarket(days: number, note: string): MarketData {
  const rng = seededRandom(42);
  const start = floorHour(Date.now()) - (days - 1) * 24 * HOUR;
  const startDay = start - berlinParts(start).hour * HOUR;
  const hours: MarketHour[] = [];
  let windState = 25;
  for (let i = 0; i < (days + 1) * 24; i++) {
    const t = startDay + i * HOUR;
    const p = berlinParts(t);
    const future = t > Date.now();
    const weekend = p.dow >= 5 ? 0.88 : 1;
    const daily = 0.8 + 0.2 * Math.sin(((p.hour - 6) / 24) * 2 * Math.PI) + (p.hour >= 17 && p.hour <= 19 ? 0.08 : 0);
    const load = 58 * daily * weekend + gaussian(rng);
    const solar = Math.max(0, 14 * Math.sin(((p.hour - 8) / 9) * Math.PI)) * (0.5 + rng() * 0.5);
    windState = Math.min(55, Math.max(2, windState + gaussian(rng) * 3));
    const residual = load - solar - windState;
    const price = 20 + 3.1 * residual + gaussian(rng) * 8;
    hours.push({
      t,
      price,
      load: future ? null : load,
      solar: future ? null : solar,
      wind: future ? null : windState,
      residual: future ? null : residual,
      renShare: future ? null : Math.min(100, ((solar + windState + 9) / load) * 100),
    });
  }
  return { source: "synthetic", note, generatedAt: Date.now(), hours };
}
