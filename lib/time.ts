// All display & calendar logic runs in Europe/Berlin, the market time zone for DE-LU.
export const TZ = "Europe/Berlin";
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  weekday: "short",
});

const DOW: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export type BerlinParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Monday … 6 = Sunday */
  dow: number;
  /** YYYY-MM-DD in Berlin local time */
  date: string;
};

const pad = (n: number) => String(n).padStart(2, "0");

const cache = new Map<number, BerlinParts>();

export function berlinParts(ms: number): BerlinParts {
  const hit = cache.get(ms);
  if (hit) return hit;
  const parts = partsFmt.formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const res: BerlinParts = {
    year,
    month,
    day,
    hour,
    minute,
    dow: DOW[get("weekday")] ?? 0,
    date: `${year}-${pad(month)}-${pad(day)}`,
  };
  if (cache.size > 60_000) cache.clear();
  cache.set(ms, res);
  return res;
}

export function todayBerlin(): string {
  return berlinParts(Date.now()).date;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + n * DAY).toISOString().slice(0, 10);
}

/** Berlin offset from UTC in minutes at a given instant (60 in winter, 120 in summer). */
export function berlinOffsetMin(ms: number): number {
  const p = berlinParts(Math.floor(ms / 60_000) * 60_000);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return Math.round((asUtc - Math.floor(ms / 60_000) * 60_000) / 60_000);
}

/** Convert a Berlin wall-clock time to a UTC timestamp (ms). */
export function berlinLocalToUtc(y: number, mo: number, d: number, h = 0, mi = 0): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off = berlinOffsetMin(guess);
  let t = guess - off * 60_000;
  const off2 = berlinOffsetMin(t);
  if (off2 !== off) t = guess - off2 * 60_000;
  return t;
}

export const floorHour = (ms: number) => Math.floor(ms / HOUR) * HOUR;

const dtFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
const dayFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: TZ,
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
});

/** "Wed 18/11, 14:00" */
export const fmtDateTime = (ms: number) => dtFmt.format(ms);
/** "Wed 18/11" */
export const fmtDay = (ms: number) => dayFmt.format(ms);
export const fmtHour = (ms: number) => `${pad(berlinParts(ms).hour)}:00`;

/** Midnight (Berlin) timestamps inside a series — used as chart ticks. */
export function dayTicks(ts: number[]): number[] {
  return ts.filter((t) => {
    const p = berlinParts(t);
    return p.hour === 0 && p.minute === 0;
  });
}
