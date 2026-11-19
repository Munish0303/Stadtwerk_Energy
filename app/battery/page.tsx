"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AskButton, Card, Field, Kpi, LegendItems, Loading, NumberInput, PageHeader, SourceBadge } from "@/components/ui";
import { chartStyles, useJson, useThemeColors } from "@/components/hooks";
import { useCopilotData } from "@/components/CopilotProvider";
import { optimizeBattery } from "@/lib/battery";
import type { MarketData } from "@/lib/types";
import { dayTicks, fmtDateTime, fmtDay } from "@/lib/time";
import { fmt, fmtEur, round } from "@/lib/stats";

const PROMPTS = [
  "Is this battery business case attractive? What are the main risks and missing revenue streams?",
  "How sensitive is the payback to the battery duration (MWh/MW ratio) and CAPEX?",
  "Explain the charging strategy in plain language for a municipal council presentation.",
];

export default function BatteryPage() {
  const c = useThemeColors();
  const s = chartStyles(c);
  const market = useJson<MarketData>("/api/market");

  const [powerMW, setPowerMW] = useState(5);
  const [capacityMWh, setCapacityMWh] = useState(10);
  const [rte, setRte] = useState(88);
  const [cycleCost, setCycleCost] = useState(12);
  const [capex, setCapex] = useState(380);
  const [opexPct, setOpexPct] = useState(1.5);
  const [lifetime, setLifetime] = useState(15);

  const view = useMemo(() => {
    if (!market.data) return null;
    const prices = market.data.hours.filter((h) => h.price !== null).map((h) => ({ t: h.t, price: h.price as number }));
    if (prices.length < 24) return null;
    const res = optimizeBattery(prices, { capacityMWh, powerMW, rte: rte / 100, cycleCost, socStart: 0.5 });
    const days = prices.length / 24;
    const perDay = res.revenue / days;
    const annual = perDay * 365;
    const capexTotal = capex * 1000 * capacityMWh;
    const opex = (opexPct / 100) * capexTotal;
    const net = annual - opex;
    const payback = net > 0 ? capexTotal / net : Infinity;
    // simple NPV @ 7 %
    const r = 0.07;
    const annuity = (1 - (1 + r) ** -lifetime) / r;
    const npv = net * annuity - capexTotal;
    const daily = res.daily.map((d) => ({ ...d, label: fmtDay(d.t) }));
    return {
      res,
      days,
      perDay,
      annual,
      capexTotal,
      opex,
      payback,
      npv,
      daily,
      steps: res.steps.map((st) => ({ ...st, charge: st.gridMW > 0 ? st.gridMW : 0, discharge: st.gridMW < 0 ? st.gridMW : 0 })),
      ticks: dayTicks(res.steps.map((x) => x.t)),
    };
  }, [market.data, powerMW, capacityMWh, rte, cycleCost, capex, opexPct, lifetime]);

  useCopilotData(
    "Battery Business Case",
    PROMPTS,
    view && {
      asset: { powerMW, capacityMWh, durationH: round(capacityMWh / powerMW, 2), roundTripEfficiencyPct: rte, degradationCostEURperMWh: cycleCost },
      economics: { capexEURperKWh: capex, capexTotalEUR: round(view.capexTotal, 0), opexPctPerYear: opexPct, lifetimeYears: lifetime, discountRatePct: 7 },
      strategy: "Day-ahead arbitrage only, perfect foresight, exact dynamic programming over SoC; start SoC = end SoC = 50%",
      results: {
        periodDays: round(view.days, 1),
        revenueEUR: round(view.res.revenue, 0),
        revenuePerDayEUR: round(view.perDay, 0),
        annualisedRevenueEUR: round(view.annual, 0),
        annualOpexEUR: round(view.opex, 0),
        simplePaybackYears: Number.isFinite(view.payback) ? round(view.payback, 1) : "never",
        npvEUR: round(view.npv, 0),
        fullCyclesPerDay: round(view.res.cycles / view.days, 2),
        avgChargePrice: round(view.res.avgBuy, 1),
        avgDischargePrice: round(view.res.avgSell, 1),
      },
      dailyRevenueEUR: view.daily.map((d) => ({ day: d.label, revenue: round(d.revenue, 0) })),
    },
  );

  return (
    <>
      <PageHeader
        eyebrow="Flexibility & storage"
        title="Battery storage business case"
        lead="Optimal day-ahead arbitrage schedule for a grid-scale battery on real German prices, with a quick techno-economic assessment — the first question every Stadtwerk asks about storage."
      >
        {market.data && <SourceBadge source={market.data.source} label="Live day-ahead prices" />}
        <AskButton question="Assess this battery business case like a consultant: is it bankable, what is missing (FCR, aFRR, intraday, grid fees), and what should the Stadtwerk do next?" label="Assess case" />
      </PageHeader>

      <Card title="Asset & economics">
        <div className="controls">
          <Field label="Power (MW)">
            <NumberInput value={powerMW} onChange={setPowerMW} min={0.1} max={1000} step={0.5} />
          </Field>
          <Field label="Capacity (MWh)" hint={`Duration ${fmt(capacityMWh / powerMW, 1)} h`}>
            <NumberInput value={capacityMWh} onChange={setCapacityMWh} min={0.1} max={4000} step={1} />
          </Field>
          <Field label="Round-trip efficiency (%)">
            <NumberInput value={rte} onChange={setRte} min={50} max={100} />
          </Field>
          <Field label="Degradation cost (€/MWh)" hint="per MWh discharged">
            <NumberInput value={cycleCost} onChange={setCycleCost} min={0} max={200} />
          </Field>
          <Field label="CAPEX (€/kWh)">
            <NumberInput value={capex} onChange={setCapex} min={50} max={2000} step={10} />
          </Field>
          <Field label="OPEX (% CAPEX / yr)">
            <NumberInput value={opexPct} onChange={setOpexPct} min={0} max={10} step={0.1} />
          </Field>
          <Field label="Lifetime (years)">
            <NumberInput value={lifetime} onChange={setLifetime} min={1} max={40} />
          </Field>
        </div>
      </Card>

      <div style={{ height: 16 }} />
      {market.error && <div className="notice error">Failed to load prices: {market.error}</div>}
      {market.data?.note && <div className="notice">{market.data.note}</div>}
      {market.loading && <Loading label="Loading day-ahead prices…" />}

      {view && (
        <>
          <div className="grid kpis">
            <Kpi label={`Arbitrage revenue (${fmt(view.days, 0)} days)`} value={fmtEur(view.res.revenue)} hint={`${fmtEur(view.perDay)} per day`} />
            <Kpi label="Annualised revenue" value={fmtEur(view.annual)} hint={`${fmtEur(view.annual / powerMW)} per MW · year`} />
            <Kpi label="Full cycles per day" value={fmt(view.res.cycles / view.days, 2)} />
            <Kpi label="Avg. buy → sell price" value={`${fmt(view.res.avgBuy, 0)} → ${fmt(view.res.avgSell, 0)}`} unit="€/MWh" />
            <Kpi
              label="Simple payback"
              value={Number.isFinite(view.payback) ? fmt(view.payback, 1) : "never"}
              unit={Number.isFinite(view.payback) ? "years" : undefined}
              tone={view.payback <= lifetime ? "good" : "bad"}
              hint={`CAPEX ${fmtEur(view.capexTotal)}`}
            />
            <Kpi label="NPV @ 7 %" value={fmtEur(view.npv)} tone={view.npv >= 0 ? "good" : "bad"} hint={`${lifetime} years, spot arbitrage only`} />
          </div>

          <div className="stack">
            <Card title="Optimal dispatch" subtitle="Bars: grid power (MW, + charge / − discharge) · line: day-ahead price (€/MWh)">
              <div className="chart tall">
                <ResponsiveContainer>
                  <ComposedChart data={view.steps} barCategoryGap={0} margin={{ top: 8, right: 0, left: -8, bottom: 0 }}>
                    <CartesianGrid {...s.grid} />
                    <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} ticks={view.ticks} tickFormatter={(v) => fmtDay(v)} {...s.axis} />
                    <YAxis yAxisId="mw" {...s.axis} width={60} unit=" MW" />
                    <YAxis yAxisId="eur" orientation="right" {...s.axis} width={44} />
                    <ReferenceLine yAxisId="mw" y={0} stroke={c.faint} />
                    <Tooltip
                      {...s.tooltip}
                      labelFormatter={(l) => fmtDateTime(Number(l))}
                      formatter={(v, n) => [n === "Price" ? `${fmt(Number(v), 1)} €/MWh` : n === "SoC" ? `${fmt(Number(v), 0)} %` : `${fmt(Number(v), 2)} MW`, n]}
                    />
                    <Bar yAxisId="mw" stackId="p" dataKey="charge" name="Charge" fill={c["c-wind"]} isAnimationActive={false} />
                    <Bar yAxisId="mw" stackId="p" dataKey="discharge" name="Discharge" fill={c["c-resid"]} isAnimationActive={false} />
                    <Line yAxisId="eur" dataKey="price" name="Price" type="stepAfter" stroke={c["c-price"]} strokeWidth={1.6} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <LegendItems
                items={[
                  { label: "Charging", color: c["c-wind"] },
                  { label: "Discharging", color: c["c-resid"] },
                  { label: "Day-ahead price", color: c["c-price"], line: true },
                ]}
              />
            </Card>

            <div className="grid cols-2">
              <Card title="State of charge" subtitle="% of usable capacity">
                <div className="chart short">
                  <ResponsiveContainer>
                    <ComposedChart data={view.steps} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                      <CartesianGrid {...s.grid} />
                      <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} ticks={view.ticks} tickFormatter={(v) => fmtDay(v)} {...s.axis} />
                      <YAxis {...s.axis} width={44} domain={[0, 100]} unit="%" />
                      <Tooltip {...s.tooltip} labelFormatter={(l) => fmtDateTime(Number(l))} formatter={(v) => [`${fmt(Number(v), 0)} %`, "SoC"]} />
                      <Line dataKey="soc" type="monotone" stroke={c.accent} strokeWidth={2} dot={false} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card title="Revenue per day" subtitle="€ — driven by daily price spread and number of profitable cycles">
                <div className="chart short">
                  <ResponsiveContainer>
                    <BarChart data={view.daily} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
                      <CartesianGrid {...s.grid} />
                      <XAxis dataKey="label" {...s.axis} />
                      <YAxis {...s.axis} width={52} />
                      <Tooltip {...s.tooltip} formatter={(v) => [fmtEur(Number(v)), "Revenue"]} />
                      <Bar dataKey="revenue" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                        {view.daily.map((d) => (
                          <Cell key={d.date} fill={d.revenue >= 0 ? c.accent : c["c-bad"]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

            <Card title="Method & caveats">
              <div className="method">
                <p>
                  <strong>Optimisation:</strong> exact dynamic programming over 60 state-of-charge levels on hourly day-ahead prices
                  (hourly averages of the 15-min auction). Charging cost = price / √η, discharging revenue = price · √η − degradation
                  cost. Start and end SoC are fixed at 50 % so no free energy is created.
                </p>
                <p>
                  <strong>Read as an upper bound for spot arbitrage:</strong> perfect foresight over ~8 days, annualised linearly
                  (seasonality ignored). Real projects stack revenues — FCR/aFRR balancing, intraday trading, peak shaving to reduce
                  grid fees (§19 StromNEV), and avoided grid expansion — which this demo does not model.
                </p>
              </div>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
