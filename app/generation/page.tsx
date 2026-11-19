"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AskButton, Card, Field, Kpi, LegendItems, Loading, NumberInput, PageHeader, SourceBadge } from "@/components/ui";
import { chartStyles, useJson, useThemeColors } from "@/components/hooks";
import { useCopilotData } from "@/components/CopilotProvider";
import { CITIES, cityByName } from "@/lib/cities";
import { DEFAULT_PV, DEFAULT_WIND, pvPower, windAtHub, windPower } from "@/lib/generation";
import type { MarketData, WeatherData } from "@/lib/types";
import { dayTicks, fmtDateTime, fmtDay } from "@/lib/time";
import { fmt, fmtEur, mean, round } from "@/lib/stats";

const PROMPTS = [
  "Compare the PV and wind capture rates — which asset is worth more per MWh this week and why?",
  "When is the best window in the next 3 days for maintenance on the wind park?",
  "How would doubling PV capacity change market value and cannibalisation risk?",
];

export default function GenerationPage() {
  const c = useThemeColors();
  const s = chartStyles(c);

  const [cityName, setCityName] = useState(CITIES[0].name);
  const [tilt, setTilt] = useState(30);
  const [azimuth, setAzimuth] = useState(0);
  const [pvMWp, setPvMWp] = useState(DEFAULT_PV.capacityMWp);
  const [pr, setPr] = useState(DEFAULT_PV.performanceRatio);
  const [turbines, setTurbines] = useState(DEFAULT_WIND.turbines);
  const [ratedMW, setRatedMW] = useState(DEFAULT_WIND.ratedMW);
  const [hub, setHub] = useState(DEFAULT_WIND.hubHeight);

  // debounce weather-affecting parameters
  const [query, setQuery] = useState<string | null>(null);
  useEffect(() => {
    const city = cityByName(cityName);
    const id = setTimeout(
      () => setQuery(`/api/weather?mode=generation&lat=${city.lat}&lon=${city.lon}&tilt=${tilt}&azimuth=${azimuth}`),
      350,
    );
    return () => clearTimeout(id);
  }, [cityName, tilt, azimuth]);

  const weather = useJson<WeatherData>(query);
  const market = useJson<MarketData>("/api/market");

  const view = useMemo(() => {
    if (!weather.data) return null;
    const priceAt = new Map<number, number>();
    market.data?.hours.forEach((h) => h.price !== null && priceAt.set(h.t, h.price));
    const pvP = { ...DEFAULT_PV, capacityMWp: pvMWp, performanceRatio: pr };
    const wP = { ...DEFAULT_WIND, turbines, ratedMW, hubHeight: hub };
    const now = Date.now();

    const rows = weather.data.hours.map((h) => {
      const pv = pvPower(h.gti ?? 0, h.temp, pvP);
      const wind = windPower(h.wind ?? 0, wP);
      return {
        t: h.t,
        pv,
        wind,
        price: priceAt.get(h.t) ?? null,
        gti: h.gti ?? 0,
        hubWind: windAtHub(h.wind ?? 0, hub),
        temp: h.temp,
      };
    });
    const future = rows.filter((r) => r.t > now).slice(0, 72);
    const sumBy = (arr: typeof rows, k: "pv" | "wind") => arr.reduce((a, r) => a + r[k], 0);
    const windCap = turbines * ratedMW;

    // market value where prices are known
    const priced = rows.filter((r) => r.price !== null);
    const value = (k: "pv" | "wind") => priced.reduce((a, r) => a + r[k] * (r.price as number), 0);
    const energyPriced = (k: "pv" | "wind") => priced.reduce((a, r) => a + r[k], 0);
    const base = mean(priced.map((r) => r.price as number));
    const capture = (k: "pv" | "wind") => (energyPriced(k) > 0 ? value(k) / energyPriced(k) : NaN);
    const negEnergy = priced.filter((r) => (r.price as number) < 0).reduce((a, r) => a + r.pv + r.wind, 0);

    // calmest 12h window (lowest lost wind energy) in the forecast
    let best = { start: NaN, lost: Infinity };
    for (let i = 0; i + 12 <= future.length; i++) {
      const lost = future.slice(i, i + 12).reduce((a, r) => a + r.wind * ((r.price ?? base) || 0), 0);
      if (lost < best.lost) best = { start: future[i].t, lost };
    }

    return {
      rows,
      ticks: dayTicks(rows.map((r) => r.t)),
      pv72: sumBy(future, "pv"),
      wind72: sumBy(future, "wind"),
      pvCf: pvMWp > 0 ? (sumBy(future, "pv") / (pvMWp * future.length)) * 100 : NaN,
      windCf: windCap > 0 ? (sumBy(future, "wind") / (windCap * future.length)) * 100 : NaN,
      pvPeak: Math.max(...future.map((r) => r.pv)),
      windPeak: Math.max(...future.map((r) => r.wind)),
      pricedHours: priced.length,
      valuePv: value("pv"),
      valueWind: value("wind"),
      base,
      capturePv: capture("pv"),
      captureWind: capture("wind"),
      negEnergy,
      maintenance: best,
      dailyForecast: groupDaily(future),
    };
  }, [weather.data, market.data, pvMWp, pr, turbines, ratedMW, hub]);

  useCopilotData(
    "PV & Wind Forecast",
    PROMPTS,
    view && {
      location: cityName,
      assets: {
        pv: { capacityMWp: pvMWp, tilt, azimuthDegFromSouth: azimuth, performanceRatio: pr },
        wind: { turbines, ratedMWEach: ratedMW, hubHeightM: hub },
      },
      next72h: {
        pvMWh: round(view.pv72, 1),
        windMWh: round(view.wind72, 1),
        pvCapacityFactorPct: round(view.pvCf, 1),
        windCapacityFactorPct: round(view.windCf, 1),
        pvPeakMW: round(view.pvPeak, 1),
        windPeakMW: round(view.windPeak, 1),
      },
      marketValueOverHoursWithKnownPrices: {
        hours: view.pricedHours,
        baseloadPrice: round(view.base, 1),
        pvRevenueEUR: round(view.valuePv, 0),
        windRevenueEUR: round(view.valueWind, 0),
        pvCapturePrice: round(view.capturePv, 1),
        windCapturePrice: round(view.captureWind, 1),
        pvCaptureRate: round(view.capturePv / view.base, 2),
        windCaptureRate: round(view.captureWind / view.base, 2),
        energyAtNegativePricesMWh: round(view.negEnergy, 1),
      },
      suggestedWindMaintenanceWindowStart: Number.isFinite(view.maintenance.start) ? fmtDateTime(view.maintenance.start) : null,
      dailyForecast: view.dailyForecast,
    },
  );

  return (
    <>
      <PageHeader
        eyebrow="Renewables forecasting"
        title="PV & wind generation forecast"
        lead="Physics-based 72-hour forecast for a utility's own PV and wind portfolio from numerical weather predictions, valued at day-ahead prices."
      >
        {weather.data && <SourceBadge source={weather.data.source} label="Live · Open-Meteo NWP" />}
      </PageHeader>

      <Card title="Portfolio & location" className="" subtitle="Weather inputs refresh automatically; capacity changes recalculate instantly.">
        <div className="controls">
          <Field label="Location">
            <select className="select" value={cityName} onChange={(e) => setCityName(e.target.value)}>
              {CITIES.map((ct) => (
                <option key={ct.name}>{ct.name}</option>
              ))}
            </select>
          </Field>
          <Field label="PV capacity (MWp)">
            <NumberInput value={pvMWp} onChange={setPvMWp} min={0} max={5000} step={1} />
          </Field>
          <Field label="Module tilt (°)">
            <NumberInput value={tilt} onChange={setTilt} min={0} max={90} />
          </Field>
          <Field label="Azimuth (° from south)" hint="−90 east · 0 south · 90 west">
            <NumberInput value={azimuth} onChange={setAzimuth} min={-180} max={180} step={5} />
          </Field>
          <Field label="Performance ratio">
            <NumberInput value={pr} onChange={setPr} min={0.5} max={1} step={0.01} />
          </Field>
          <Field label="Wind turbines">
            <NumberInput value={turbines} onChange={setTurbines} min={0} max={500} />
          </Field>
          <Field label="Rated power / turbine (MW)">
            <NumberInput value={ratedMW} onChange={setRatedMW} min={0.5} max={20} step={0.1} />
          </Field>
          <Field label="Hub height (m)">
            <NumberInput value={hub} onChange={setHub} min={50} max={250} step={5} />
          </Field>
        </div>
      </Card>

      <div style={{ height: 16 }} />
      {weather.error && <div className="notice error">Weather request failed: {weather.error}</div>}
      {weather.data?.note && <div className="notice">{weather.data.note}</div>}
      {weather.loading && !view && <Loading label="Fetching weather forecast…" />}

      {view && (
        <>
          <div className="grid kpis">
            <Kpi label="PV energy, next 72 h" value={fmt(view.pv72, 1)} unit="MWh" hint={`capacity factor ${fmt(view.pvCf, 1)} %`} />
            <Kpi label="Wind energy, next 72 h" value={fmt(view.wind72, 1)} unit="MWh" hint={`capacity factor ${fmt(view.windCf, 1)} %`} />
            <Kpi
              label="PV capture rate"
              value={fmt(view.capturePv / view.base, 2)}
              hint={`${fmt(view.capturePv, 1)} vs ${fmt(view.base, 1)} €/MWh baseload`}
              tone={view.capturePv / view.base < 0.85 ? "bad" : undefined}
            />
            <Kpi
              label="Wind capture rate"
              value={fmt(view.captureWind / view.base, 2)}
              hint={`${fmt(view.captureWind, 1)} €/MWh capture price`}
              tone={view.captureWind / view.base < 0.85 ? "bad" : undefined}
            />
            <Kpi label="Spot revenue (priced hours)" value={fmtEur(view.valuePv + view.valueWind)} hint={`${view.pricedHours} h with known day-ahead prices`} />
            <Kpi label="Energy at negative prices" value={fmt(view.negEnergy, 1)} unit="MWh" tone={view.negEnergy > 0 ? "bad" : undefined} hint="§51 EEG curtailment exposure" />
          </div>

          <div className="stack">
            <Card
              title="Portfolio output & day-ahead price"
              subtitle="MW (left) · €/MWh (right). Vertical line = now; left of it is yesterday's modelled output."
              actions={<AskButton question="Describe the generation forecast for the next 3 days and flag the hours with the highest marketing risk." label="Explain forecast" />}
            >
              <div className="chart tall">
                <ResponsiveContainer>
                  <ComposedChart data={view.rows} margin={{ top: 8, right: 0, left: -8, bottom: 0 }}>
                    <CartesianGrid {...s.grid} />
                    <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} ticks={view.ticks} tickFormatter={(v) => fmtDay(v)} {...s.axis} />
                    <YAxis yAxisId="mw" {...s.axis} unit=" MW" width={64} />
                    <YAxis yAxisId="eur" orientation="right" {...s.axis} width={44} />
                    <ReferenceLine yAxisId="mw" x={Date.now()} stroke={c.muted} strokeDasharray="3 3" label={{ value: "now", fill: c.muted, fontSize: 11, position: "insideTopLeft" }} />
                    <Tooltip
                      {...s.tooltip}
                      labelFormatter={(l) => fmtDateTime(Number(l))}
                      formatter={(v, n) => [n === "Price" ? `${fmt(Number(v), 1)} €/MWh` : `${fmt(Number(v), 2)} MW`, n]}
                    />
                    <Area yAxisId="mw" dataKey="wind" name="Wind" stackId="g" type="monotone" stroke="none" fill={c["c-wind"]} fillOpacity={0.7} isAnimationActive={false} />
                    <Area yAxisId="mw" dataKey="pv" name="PV" stackId="g" type="monotone" stroke="none" fill={c["c-solar"]} fillOpacity={0.8} isAnimationActive={false} />
                    <Line yAxisId="eur" dataKey="price" name="Price" type="stepAfter" stroke={c["c-price"]} strokeWidth={1.6} dot={false} isAnimationActive={false} connectNulls={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <LegendItems
                items={[
                  { label: "Wind", color: c["c-wind"] },
                  { label: "PV", color: c["c-solar"] },
                  { label: "Day-ahead price", color: c["c-price"], line: true },
                ]}
              />
            </Card>

            <div className="grid cols-2">
              <Card title="Weather drivers" subtitle="Plane-of-array irradiance (W/m²) and wind speed at hub height (m/s)">
                <div className="chart short">
                  <ResponsiveContainer>
                    <ComposedChart data={view.rows} margin={{ top: 8, right: 0, left: -8, bottom: 0 }}>
                      <CartesianGrid {...s.grid} />
                      <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} ticks={view.ticks} tickFormatter={(v) => fmtDay(v)} {...s.axis} />
                      <YAxis yAxisId="w" {...s.axis} width={50} />
                      <YAxis yAxisId="v" orientation="right" {...s.axis} width={34} />
                      <Tooltip {...s.tooltip} labelFormatter={(l) => fmtDateTime(Number(l))} formatter={(v, n) => [fmt(Number(v), 1), n]} />
                      <Area yAxisId="w" dataKey="gti" name="Irradiance W/m²" type="monotone" stroke={c["c-solar"]} fill={c["c-solar"]} fillOpacity={0.2} isAnimationActive={false} />
                      <Line yAxisId="v" dataKey="hubWind" name="Wind m/s" type="monotone" stroke={c["c-wind"]} strokeWidth={1.8} dot={false} isAnimationActive={false} />
                      <ReferenceLine yAxisId="v" y={12.5} stroke={c["c-wind"]} strokeDasharray="2 4" />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card title="Method" subtitle="Transparent, explainable models — easy to defend in a client workshop">
                <div className="method">
                  <p>
                    <strong>PV:</strong> <code>P = P<sub>STC</sub> · G<sub>POA</sub>/1000 · PR · (1 + γ(T<sub>cell</sub> − 25))</code> with
                    Open-Meteo plane-of-array irradiance, Ross cell-temperature model (k = 0.03) and γ = −0.37 %/K.
                  </p>
                  <p>
                    <strong>Wind:</strong> 120 m NWP wind speed scaled to hub height via power law (α = 0.14), generic power curve
                    (cut-in 3, rated 12.5, cut-out 25 m/s) and 10 % availability/wake losses.
                  </p>
                  <p>
                    <strong>Value:</strong> capture price = Σ(P·price)/ΣP over hours with published day-ahead prices; capture rate =
                    capture price / baseload average. Rates below ~0.85 indicate cannibalisation.
                  </p>
                  {Number.isFinite(view.maintenance.start) && (
                    <p>
                      <strong>Lowest-value 12 h window for wind maintenance:</strong> from {fmtDateTime(view.maintenance.start)}.
                    </p>
                  )}
                </div>
              </Card>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function groupDaily(rows: { t: number; pv: number; wind: number }[]) {
  const m = new Map<string, { pv: number; wind: number }>();
  rows.forEach((r) => {
    const d = fmtDay(r.t);
    const a = m.get(d) ?? { pv: 0, wind: 0 };
    a.pv += r.pv;
    a.wind += r.wind;
    m.set(d, a);
  });
  return [...m].map(([day, a]) => ({ day, pvMWh: round(a.pv, 1), windMWh: round(a.wind, 1) }));
}
