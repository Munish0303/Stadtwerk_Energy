import { NextRequest, NextResponse } from "next/server";
import { getGenerationWeather, getTemperatures } from "@/lib/weather";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function numParam(req: NextRequest, key: string, min: number, max: number, fallback?: number): number {
  const raw = req.nextUrl.searchParams.get(key);
  const v = raw === null ? fallback : Number(raw);
  if (v === undefined || !Number.isFinite(v) || v < min || v > max) throw new Error(`Invalid "${key}"`);
  return v;
}

export async function GET(req: NextRequest) {
  try {
    const lat = numParam(req, "lat", -90, 90);
    const lon = numParam(req, "lon", -180, 180);
    const mode = req.nextUrl.searchParams.get("mode") ?? "generation";
    const headers = { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" };

    if (mode === "temperature") {
      const start = req.nextUrl.searchParams.get("start") ?? "";
      const end = req.nextUrl.searchParams.get("end") ?? "";
      if (!DATE.test(start) || !DATE.test(end) || start > end) throw new Error("Invalid start/end date");
      if (Date.parse(end) - Date.parse(start) > 3 * 366 * 86_400_000) throw new Error("Date range too long (max 3 years)");
      if (start < "1990-01-01") throw new Error("Start date too early");
      return NextResponse.json(await getTemperatures(lat, lon, start, end), { headers });
    }

    const tilt = numParam(req, "tilt", 0, 90, 30);
    const azimuth = numParam(req, "azimuth", -180, 180, 0);
    return NextResponse.json(await getGenerationWeather(lat, lon, tilt, azimuth), { headers });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
