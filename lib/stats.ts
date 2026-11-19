export const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
export const mean = (a: number[]) => (a.length ? sum(a) / a.length : NaN);

export function std(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1));
}

export function quantile(a: number[], q: number): number {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Mean absolute percentage error in % (skips near-zero actuals). */
export function mape(actual: number[], pred: number[]): number {
  const errs: number[] = [];
  actual.forEach((a, i) => {
    if (Math.abs(a) > 1e-9 && Number.isFinite(pred[i])) errs.push(Math.abs((a - pred[i]) / a));
  });
  return errs.length ? (100 * sum(errs)) / errs.length : NaN;
}

export function rmse(actual: number[], pred: number[]): number {
  if (!actual.length) return NaN;
  return Math.sqrt(sum(actual.map((a, i) => (a - pred[i]) ** 2)) / actual.length);
}

export function pearson(x: number[], y: number[]): number {
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < x.length; i++) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : NaN;
}

/** Ordinary least squares y = a + b·x */
export function linreg(x: number[], y: number[]): { a: number; b: number } {
  const mx = mean(x);
  const my = mean(y);
  let num = 0;
  let den = 0;
  for (let i = 0; i < x.length; i++) {
    num += (x[i] - mx) * (y[i] - my);
    den += (x[i] - mx) ** 2;
  }
  const b = den ? num / den : 0;
  return { a: my - b * mx, b };
}

/** Deterministic PRNG (mulberry32) so synthetic data is reproducible. */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const round = (x: number, d = 1) => {
  const f = 10 ** d;
  return Math.round(x * f) / f;
};

const nf = (d: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const cacheNf = new Map<number, Intl.NumberFormat>();
export function fmt(x: number | null | undefined, d = 1): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return "–";
  let f = cacheNf.get(d);
  if (!f) {
    f = nf(d);
    cacheNf.set(d, f);
  }
  return f.format(x);
}

export function fmtEur(x: number, d = 0): string {
  if (!Number.isFinite(x)) return "–";
  const abs = Math.abs(x);
  if (abs >= 1e6) return `€${fmt(x / 1e6, 2)}M`;
  if (abs >= 1e4) return `€${fmt(x / 1e3, 1)}k`;
  return `€${fmt(x, d)}`;
}
