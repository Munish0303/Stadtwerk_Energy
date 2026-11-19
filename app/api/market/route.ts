import { NextResponse } from "next/server";
import { getMarket } from "@/lib/energyCharts";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getMarket(7);
  return NextResponse.json(data, {
    headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600" },
  });
}
