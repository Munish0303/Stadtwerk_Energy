import "server-only";
import type { WeatherData, WeatherHour } from "./types";
import { addDays, DAY, floorHour, HOUR } from "./time";
import { gaussian, seededRandom } from "./stats";

// Open-Meteo (open-meteo.com, CC BY 4.0). No key needed for non-commercial use.
const FORECAST = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";

type OMResp = { hourly: Record<string, (number | null)[]> & { time: number[] } };

async function om(base: string, params: Record<string, string | number>): Promise<OMResp> {
  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries({ ...params, timeformat: "unixtime", timezone: "GMT" }).map(([k, v]) => [k, String(v)])),
  );
  const res = await fetch(`${base}?${qs}`, {
    next: { revalidate: 1800 },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}: ${await res.text()}`);
  return (await res.json()) as OMResp;
}

const num = (v: number | null | undefined) => (v === null || v === undefined ? undefined : v);

/** Weather drivers for PV & wind generation: yesterday → +3 days. */
export async function getGenerationWeather(
  lat: number,
  lon: number,
  tilt: number,
  azimuth: number,
): Promise<WeatherData> {
  try {
    const d = await om(FORECAST, {
      latitude: lat,
      longitude: lon,
      hourly: "temperature_2m,global_tilted_irradiance,shortwave_radiation,wind_speed_120m,cloud_cover",
      tilt,
      azimuth,
      wind_speed_unit: "ms",
      past_days: 1,
      forecast_days: 4,
    });
    const h = d.hourly;
    const hours: WeatherHour[] = h.time.map((sec, i) => ({
      t: sec * 1000,
      temp: h.temperature_2m[i] ?? 10,
      gti: num(h.global_tilted_irradiance[i]) ?? 0,
      ghi: num(h.shortwave_radiation[i]) ?? 0,
      wind: num(h.wind_speed_120m[i]) ?? 0,
      cloud: num(h.cloud_cover[i]),
    }));
    return { source: "live", hours };
  } catch (e) {
    return synthWeather(Date.now() - DAY, Date.now() + 4 * DAY, `Open-Meteo unreachable (${(e as Error).message}) — synthetic weather.`);
  }
}

/** Hourly 2 m temperature for any date range, stitching ERA5 archive + forecast. */
export async function getTemperatures(lat: number, lon: number, start: string, end: string): Promise<WeatherData> {
  const today = new Date().toISOString().slice(0, 10);
  const maxEnd = addDays(today, 15);
  const endClamped = end > maxEnd ? maxEnd : end;
  const archiveLimit = addDays(today, -7); // ERA5 lags ~5 days
  const forecastFloor = addDays(today, -85); // forecast API keeps ~3 months of history

  const segments: { base: string; start: string; end: string }[] = [];
  if (start < forecastFloor) {
    const aEnd = endClamped < archiveLimit ? endClamped : archiveLimit;
    segments.push({ base: ARCHIVE, start, end: aEnd });
    if (endClamped > aEnd) segments.push({ base: FORECAST, start: addDays(aEnd, 1), end: endClamped });
  } else {
    segments.push({ base: FORECAST, start, end: endClamped });
  }

  try {
    const results = await Promise.all(
      segments.map((s) =>
        om(s.base, { latitude: lat, longitude: lon, hourly: "temperature_2m", start_date: s.start, end_date: s.end }),
      ),
    );
    const map = new Map<number, number>();
    results.forEach((r) =>
      r.hourly.time.forEach((sec, i) => {
        const v = r.hourly.temperature_2m[i];
        if (v !== null && v !== undefined) map.set(sec * 1000, v);
      }),
    );
    const hours = [...map].sort((a, b) => a[0] - b[0]).map(([t, temp]) => ({ t, temp }));
    return { source: "live", hours };
  } catch (e) {
    const s = Date.parse(`${start}T00:00:00Z`);
    const en = Date.parse(`${endClamped}T23:00:00Z`);
    return synthWeather(s, en, `Open-Meteo unreachable (${(e as Error).message}) — synthetic temperatures.`);
  }
}

function synthWeather(from: number, to: number, note: string): WeatherData {
  const rng = seededRandom(7);
  const hours: WeatherHour[] = [];
  let wind = 7;
  for (let t = floorHour(from); t <= to; t += HOUR) {
    const h = new Date(t).getUTCHours();
    const doy = (t / DAY) % 365.25;
    const seasonal = 10 - 8 * Math.cos(((doy - 15) / 365.25) * 2 * Math.PI);
    const temp = seasonal + 3 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + gaussian(rng) * 0.8;
    const sun = Math.max(0, Math.sin(((h - 6) / 12) * Math.PI)) * (350 + 300 * Math.sin(((doy - 80) / 365.25) * 2 * Math.PI));
    wind = Math.min(22, Math.max(0.5, wind + gaussian(rng) * 0.9));
    hours.push({ t, temp, gti: sun * 1.1, ghi: sun, wind, cloud: 50 });
  }
  return { source: "synthetic", note, hours };
}
