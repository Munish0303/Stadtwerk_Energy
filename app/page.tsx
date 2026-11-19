"use client";

import { useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AskButton, Card, Kpi, LegendItems, Loading, PageHeader, SourceBadge } from "@/components/ui";
import { chartStyles, useJson, useThemeColors } from "@/components/hooks";
import { useCopilotData } from "@/components/CopilotProvider";
import type { MarketData } from "@/lib/types";
import { berlinParts, dayTicks, fmtDateTime, fmtDay, todayBerlin, addDays } from "@/lib/time";
import { fmt, linreg, mean, pearson, round } from "@/lib/stats";

const PROMPTS = [
  "Why were prices negative or very low in some hours this week?",
  "Explain the merit-order effect using the scatter plot numbers.",
  "What do tomorrow's day-ahead prices mean for a Stadtwerk's procurement and flexible assets?",
];

export default function MarketPage() {
  const { data, error, loading } = useJson<MarketData>("/api/market");
  const c = useThemeColors();
  const s = chartStyles(c);

  const view = useMemo(() => {
    if (!data) return null;
    const hours = data.hours;
    const now = Date.now();
    const tomorrow = addDays(todayBerlin(), 1);
    const priced = hours.filter((h) => h.price !== null);
    const past = priced.filter((h) => h.t <= now);
    const tomorrowHours = priced.filter((h) => berlinParts(h.t).date === tomorrow);
    const prices = past.map((h) => h.price as number);
    const actual = hours.filter((h) => h.load !== null);
    const both = hours.filter((h) => h.price !== null && h.residual !== null);
    const x = both.map((h) => h.residual as number);
    const y = both.map((h) => h.price as number);
    const fit = both.length > 10 ? linreg(x, y) : { a: NaN, b: NaN };
    const minP = past.reduce((m, h) => ((h.price as number) < (m.price as number) ? h : m), past[0]);
    const maxP = past.reduce((m, h) => ((h.price as number) > (m.price as number) ? h : m), past[0]);

    // daily summary for the copilot
    const days = new Map<string, { p: number[]; ren: number[]; wind: number; solar: number; load: number }>();
    hours.forEach((h) => {
      const d = berlinParts(h.t).date;
      const a = days.get(d) ?? { p: [], ren: [], wind: 0, solar: 0, load: 0 };
      if (h.price !== null) a.p.push(h.price);
      if (h.renShare !== null) a.ren.push(h.renShare);
      a.wind += h.wind ?? 0;
      a.solar += h.solar ?? 0;
      a.load += h.load ?? 0;
      days.set(d, a);
    });
    const daily = [...days].map(([date, a]) => ({
      date,
      avgPrice: round(mean(a.p), 1),
      minPrice: round(Math.min(...a.p), 1),
      maxPrice: round(Math.max(...a.p), 1),
      renewableSharePct: a.ren.length ? round(mean(a.ren), 1) : null,
      windGWh: round(a.wind, 0),
      solarGWh: round(a.solar, 0),
      loadGWh: round(a.load, 0),
    }));

    return {
      hours,
      ticks: dayTicks(hours.map((h) => h.t)),
      tomorrowStart: tomorrowHours[0]?.t ?? null,
      tomorrowHours,
      avg: mean(prices),
      minP,
      maxP,
      negHours: prices.filter((p) => p < 0).length,
      ren: mean(actual.map((h) => h.renShare as number).filter((v) => v !== null)),
      peakWind: Math.max(...actual.map((h) => h.wind ?? 0)),
      scatter: both.map((h) => ({ x: h.residual as number, y: h.price as number })),
      fit,
      r: pearson(x, y),
      xMin: Math.min(...x),
      xMax: Math.max(...x),
      daily,
    };
  }, [data]);

  useCopilotData(
    "Market & Grid (Germany, DE-LU)",
    PROMPTS,
    view && {
      description: "German day-ahead prices (€/MWh, hourly avg of 15-min) and public net generation (GW), last 7 days + tomorrow.",
      kpis: {
        avgPrice7d: round(view.avg, 1),
        minPrice: view.minP && { value: round(view.minP.price as number, 1), at: fmtDateTime(view.minP.t) },
        maxPrice: view.maxP && { value: round(view.maxP.price as number, 1), at: fmtDateTime(view.maxP.t) },
        negativePriceHours: view.negHours,
        avgRenewableSharePct: round(view.ren, 1),
        meritOrderSlope_EURperMWh_perGW_residual: round(view.fit.b, 2),
        correlationResidualLoadPrice: round(view.r, 2),
      },
      daily: view.daily,
      tomorrowHourlyPrices: view.tomorrowHours.map((h) => ({ hour: berlinParts(h.t).hour, price: round(h.price as number, 1) })),
    },
  );

  return (
    <>
      <PageHeader
        eyebrow="Market intelligence"
        title="German power market & grid"
        lead="Day-ahead prices for the DE-LU bidding zone alongside load, wind and solar generation — the basis for procurement, flexibility and renewables valuation."
      >
        {data && <SourceBadge source={data.source} label="Live · Energy-Charts / SMARD" />}
        <AskButton question="Summarise this week in the German power market in 5 bullets for a utility management meeting." label="Weekly summary" />
      </PageHeader>

      {error && <div className="notice error">Failed to load market data: {error}</div>}
      {data?.note && <div className="notice">{data.note}</div>}
      {loading && <Loading label="Fetching prices and generation from Energy-Charts…" />}

      {view && (
        <>
          <div className="grid kpis">
            <Kpi label="Avg. day-ahead price (7d)" value={fmt(view.avg, 1)} unit="€/MWh" />
            <Kpi
              label="Lowest hour"
              value={fmt(view.minP?.price, 1)}
              unit="€/MWh"
              hint={view.minP && fmtDateTime(view.minP.t)}
              tone={(view.minP?.price ?? 0) < 0 ? "bad" : undefined}
            />
            <Kpi label="Highest hour" value={fmt(view.maxP?.price, 1)} unit="€/MWh" hint={view.maxP && fmtDateTime(view.maxP.t)} />
            <Kpi label="Negative-price hours" value={view.negHours} hint="hours with price < 0 €/MWh" />
            <Kpi label="Renewable share of load" value={fmt(view.ren, 1)} unit="%" hint="7-day average" tone="good" />
            <Kpi label="Peak wind feed-in" value={fmt(view.peakWind, 1)} unit="GW" hint="onshore + offshore" />
          </div>

          <div className="stack">
            <Card
              title="Generation, load & residual load"
              subtitle="Hourly averages, GW. Residual load = load − wind − solar: what conventional plants, storage and imports must cover."
            >
              <div className="chart tall">
                <ResponsiveContainer>
                  <ComposedChart data={view.hours} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                    <CartesianGrid {...s.grid} />
                    <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} ticks={view.ticks} tickFormatter={(v) => fmtDay(v)} {...s.axis} />
                    <YAxis {...s.axis} unit=" GW" width={62} />
                    <Tooltip {...s.tooltip} labelFormatter={(l) => fmtDateTime(Number(l))} formatter={(v, n) => [`${fmt(Number(v), 1)} GW`, n]} />
                    <Area dataKey="wind" name="Wind" stackId="re" type="monotone" stroke="none" fill={c["c-wind"]} fillOpacity={0.75} isAnimationActive={false} connectNulls={false} />
                    <Area dataKey="solar" name="Solar" stackId="re" type="monotone" stroke="none" fill={c["c-solar"]} fillOpacity={0.8} isAnimationActive={false} connectNulls={false} />
                    <Line dataKey="load" name="Load" type="monotone" stroke={c["c-load"]} strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line dataKey="residual" name="Residual load" type="monotone" stroke={c["c-resid"]} strokeWidth={1.6} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <LegendItems
                items={[
                  { label: "Wind", color: c["c-wind"] },
                  { label: "Solar", color: c["c-solar"] },
                  { label: "Load", color: c["c-load"], line: true },
                  { label: "Residual load", color: c["c-resid"], line: true },
                ]}
              />
            </Card>

            <div className="grid cols-3-1">
              <Card
                title="Day-ahead price (EPEX, DE-LU)"
                subtitle={view.tomorrowStart ? "Shaded: tomorrow's auction results" : "Tomorrow's prices appear after the ~12:45 auction."}
                actions={<AskButton question="Analyse tomorrow's day-ahead price curve: cheapest and most expensive hours, spread, and how a Stadtwerk could use flexibility." label="Explain" />}
              >
                <div className="chart">
                  <ResponsiveContainer>
                    <ComposedChart data={view.hours} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                      <CartesianGrid {...s.grid} />
                      <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} ticks={view.ticks} tickFormatter={(v) => fmtDay(v)} {...s.axis} />
                      <YAxis {...s.axis} width={56} />
                      {view.tomorrowStart && (
                        <ReferenceArea x1={view.tomorrowStart} x2={view.hours[view.hours.length - 1].t} fill={c["c-price"]} fillOpacity={0.07} />
                      )}
                      <ReferenceLine y={0} stroke={c.faint} />
                      <Tooltip {...s.tooltip} labelFormatter={(l) => fmtDateTime(Number(l))} formatter={(v) => [`${fmt(Number(v), 2)} €/MWh`, "Price"]} />
                      <Line dataKey="price" type="stepAfter" stroke={c["c-price"]} strokeWidth={1.8} dot={false} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              <Card
                title="Merit-order effect"
                subtitle={`Price vs residual load · r = ${fmt(view.r, 2)} · slope ≈ ${fmt(view.fit.b, 2)} €/MWh per GW`}
              >
                <div className="chart">
                  <ResponsiveContainer>
                    <ScatterChart margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                      <CartesianGrid {...s.grid} vertical />
                      <XAxis dataKey="x" type="number" name="Residual load" unit=" GW" domain={["auto", "auto"]} {...s.axis} />
                      <YAxis dataKey="y" type="number" name="Price" width={50} {...s.axis} />
                      <Tooltip {...s.tooltip} formatter={(v, n) => [fmt(Number(v), 1), n]} />
                      <Scatter data={view.scatter} fill={c["c-price"]} fillOpacity={0.45} isAnimationActive={false} />
                      {Number.isFinite(view.fit.b) && (
                        <ReferenceLine
                          segment={[
                            { x: view.xMin, y: view.fit.a + view.fit.b * view.xMin },
                            { x: view.xMax, y: view.fit.a + view.fit.b * view.xMax },
                          ]}
                          stroke={c["c-resid"]}
                          strokeWidth={2}
                        />
                      )}
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}
