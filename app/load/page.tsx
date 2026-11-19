"use client";

import { useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AskButton, Card, Field, Kpi, LegendItems, Loading, PageHeader, SourceBadge } from "@/components/ui";
import { chartStyles, useJson, useThemeColors, type ThemeColors } from "@/components/hooks";
import { useCopilotData } from "@/components/CopilotProvider";
import { CITIES, cityByName } from "@/lib/cities";
import { analyzeLoad, generateSampleLoad, resampleHourly, type Pt } from "@/lib/loadModel";
import { downloadText, parseLoadCsv, toExcelCsv } from "@/lib/csv";
import type { WeatherData } from "@/lib/types";
import { addDays, berlinParts, dayTicks, floorHour, fmtDateTime, fmtDay, HOUR, todayBerlin } from "@/lib/time";
import { fmt, round } from "@/lib/stats";

const PROMPTS = [
  "How good is the forecast compared with the naive benchmark, and is it good enough for procurement?",
  "Explain the detected anomalies and what could cause them in a distribution grid.",
  "How temperature-sensitive is this load, and what does a cold snap of −5 °C mean for peak demand?",
];

type Mode = "sample" | "upload";

export default function LoadPage() {
  const c = useThemeColors();
  const s = chartStyles(c);
  const [mode, setMode] = useState<Mode>("sample");
  const [cityName, setCityName] = useState(CITIES[0].name);
  const [unit, setUnit] = useState("MW");
  const [upload, setUpload] = useState<{ name: string; points: Pt[]; skipped: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const city = cityByName(cityName);

  const tempUrl = useMemo(() => {
    if (mode === "sample") {
      const today = todayBerlin();
      return `/api/weather?mode=temperature&lat=${city.lat}&lon=${city.lon}&start=${addDays(today, -70)}&end=${addDays(today, 8)}`;
    }
    if (!upload || upload.points.length === 0) return null;
    const first = berlinParts(upload.points[0].t).date;
    const last = berlinParts(upload.points[upload.points.length - 1].t).date;
    return `/api/weather?mode=temperature&lat=${city.lat}&lon=${city.lon}&start=${addDays(first, -1)}&end=${addDays(last, 8)}`;
  }, [mode, upload, city.lat, city.lon]);

  const temps = useJson<WeatherData>(tempUrl);

  const result = useMemo(() => {
    if (!temps.data) return null;
    const tp: Pt[] = temps.data.hours.map((h) => ({ t: h.t, v: h.temp }));
    let series: Pt[];
    if (mode === "sample") {
      series = generateSampleLoad(tp, floorHour(Date.now()) - HOUR);
    } else {
      if (!upload) return null;
      series = upload.points;
    }
    if (series.length < 14 * 24) return { error: `Need at least 14 days of hourly data (got ${(series.length / 24).toFixed(1)} days).` };
    try {
      return { analysis: analyzeLoad(series, tp) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [temps.data, mode, upload]);

  const a = result && "analysis" in result ? result.analysis : null;

  const chartData = useMemo(() => {
    if (!a) return null;
    const hist = a.history.slice(-21 * 24).map((h) => ({ t: h.t, actual: h.actual, fitted: h.fitted }));
    const fc = a.forecast.map((f) => ({ t: f.t, pred: f.pred, band: f.band }));
    const merged = [...hist, ...fc];
    return { merged, ticks: dayTicks(merged.map((m) => m.t)).filter((_, i) => i % 2 === 0), forecastStart: fc[0]?.t };
  }, [a]);

  const handleFile = async (file: File) => {
    setUploadError(null);
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error("File too large (max 15 MB).");
      const text = await file.text();
      const { points, skipped } = parseLoadCsv(text);
      if (points.length < 24) throw new Error("Could not find timestamp/value rows. Expected e.g. `2025-01-01 00:15;123,4`.");
      const hourly = resampleHourly(points);
      if (hourly.length > 3 * 8784) throw new Error("Please upload at most 3 years of data.");
      setUpload({ name: file.name, points: hourly, skipped });
      setUnit("kW");
    } catch (e) {
      setUploadError((e as Error).message);
    }
  };

  useCopilotData(
    "Load Forecasting",
    PROMPTS,
    a && {
      dataset: mode === "sample" ? "Synthetic municipal grid load (~150k inhabitants) driven by real temperatures" : `Uploaded file ${upload?.name}`,
      unit,
      temperatureLocation: cityName,
      kpis: {
        days: round(a.kpis.days, 1),
        peak: round(a.kpis.peak, 2),
        peakAt: fmtDateTime(a.kpis.peakTime),
        baseLoadP5: round(a.kpis.base, 2),
        average: round(a.kpis.avg, 2),
        loadFactor: round(a.kpis.loadFactor, 3),
        energy: `${round(a.kpis.energy, 0)} ${unit}h`,
      },
      model: "Ridge regression: hour-of-week profile (NRW holidays as Sundays) + heating/cooling degree hours",
      backtest: {
        holdoutHours: a.metrics.holdoutHours,
        modelMAPEpct: round(a.metrics.mape, 2),
        seasonalNaiveMAPEpct: round(a.metrics.naiveMape, 2),
        naiveLagHours: a.metrics.naiveLag,
        skillVsNaive: round(a.metrics.skill, 3),
        rmse: round(a.metrics.rmse, 3),
      },
      temperatureSensitivity: {
        heatingPerKelvinBelow15C: round(a.heatSlope, 3),
        coolingPerKelvinAbove22C: round(a.coolSlope, 3),
      },
      anomalies: a.anomalies.slice(0, 8).map((x) => ({ at: fmtDateTime(x.t), actual: round(x.actual, 2), expected: round(x.expected, 2), z: round(x.z, 1) })),
      forecastNext7dDailyAvg: dailyAvg(a.forecast.map((f) => ({ t: f.t, v: f.pred }))),
      forecastPeak: round(Math.max(...a.forecast.map((f) => f.pred)), 2),
    },
  );

  return (
    <>
      <PageHeader
        eyebrow="Smart-meter analytics"
        title="Load analysis & 7-day forecast"
        lead="Profile, benchmark and forecast electricity consumption — from a grid area, an RLM customer or a supply portfolio. Weather-driven model, back-tested against a naive benchmark, with anomaly detection."
      >
        {temps.data && <SourceBadge source={temps.data.source} label="Live temperatures · Open-Meteo" />}
      </PageHeader>

      <Card title="Data source">
        <div className="row" style={{ marginBottom: 14 }}>
          <div className="segmented">
            <button className={mode === "sample" ? "on" : ""} onClick={() => { setMode("sample"); setUnit("MW"); }}>
              Sample grid area
            </button>
            <button className={mode === "upload" ? "on" : ""} onClick={() => setMode("upload")}>
              Upload CSV
            </button>
          </div>
          <span className="spacer" />
          <button
            className="btn small"
            onClick={() => {
              const rows = a ? a.history.map((h) => [fmtLocal(h.t), h.actual]) : [];
              downloadText("load_profile_template.csv", toExcelCsv(["timestamp (Europe/Berlin)", `load (${unit})`], rows.slice(0, 24 * 60)));
            }}
          >
            ↓ CSV template
          </button>
        </div>
        <div className="controls">
          <Field label="Temperature location">
            <select className="select" value={cityName} onChange={(e) => setCityName(e.target.value)}>
              {CITIES.map((ct) => (
                <option key={ct.name}>{ct.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Unit label" hint="Values are read as average power per interval">
            <select className="select" value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option>kW</option>
              <option>MW</option>
            </select>
          </Field>
        </div>
        {mode === "upload" && (
          <div style={{ marginTop: 14 }}>
            <div
              className={`dropzone ${dragOver ? "over" : ""}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files[0];
                if (f) void handleFile(f);
              }}
            >
              {upload ? (
                <>
                  <strong>{upload.name}</strong> — {upload.points.length.toLocaleString()} hourly values
                  {upload.skipped > 0 && ` (${upload.skipped} rows skipped)`} · click to replace
                </>
              ) : (
                <>
                  Drop a load profile CSV here or click to browse.
                  <br />
                  <span className="small">
                    15-min or hourly · <code>timestamp;value</code> · ISO or <code>DD.MM.YYYY HH:MM</code> · decimal comma OK · ≥ 14 days
                  </span>
                </>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,text/csv"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = "";
              }}
            />
          </div>
        )}
      </Card>

      <div style={{ height: 16 }} />
      {uploadError && <div className="notice error">{uploadError}</div>}
      {temps.error && <div className="notice error">Temperature request failed: {temps.error}</div>}
      {temps.data?.note && <div className="notice">{temps.data.note}</div>}
      {result && "error" in result && <div className="notice error">{result.error}</div>}
      {mode === "upload" && !upload && !uploadError && (
        <div className="notice">Upload a file to run the analysis. Try the sample first, then use “CSV template” to see the expected format.</div>
      )}
      {temps.loading && <Loading label="Loading temperatures and fitting the model…" />}

      {a && chartData && !temps.loading && (
        <>
          <div className="grid kpis">
            <Kpi label="Peak load" value={fmt(a.kpis.peak, 1)} unit={unit} hint={fmtDateTime(a.kpis.peakTime)} />
            <Kpi label="Base load (P5)" value={fmt(a.kpis.base, 1)} unit={unit} />
            <Kpi label="Load factor" value={fmt(a.kpis.loadFactor * 100, 1)} unit="%" hint="average / peak" />
            <Kpi
              label="Forecast MAPE (back-test)"
              value={fmt(a.metrics.mape, 2)}
              unit="%"
              hint={`last ${a.metrics.holdoutHours / 24} days, out-of-sample`}
              tone="good"
            />
            <Kpi
              label="Skill vs. naive"
              value={`${fmt(a.metrics.skill * 100, 0)} %`}
              hint={`naive (t−${a.metrics.naiveLag}h) MAPE ${fmt(a.metrics.naiveMape, 2)} %`}
              tone={a.metrics.skill > 0 ? "good" : "bad"}
            />
            <Kpi label="Heating sensitivity" value={fmt(a.heatSlope, 2)} unit={`${unit}/K`} hint="per K below 15 °C" />
          </div>

          <div className="stack">
            <Card
              title="Recent load & 7-day forecast"
              subtitle={`${unit}, hourly. Shaded band ≈ 80 % prediction interval.`}
              actions={
                <div className="row">
                  <AskButton question="Summarise the 7-day load forecast: expected peak, its timing, and risks for procurement and grid operation." label="Explain" />
                  <button
                    className="btn small"
                    onClick={() =>
                      downloadText(
                        "load_forecast_7d.csv",
                        toExcelCsv(
                          ["timestamp (Europe/Berlin)", `forecast (${unit})`, "lower 80%", "upper 80%", "temperature (°C)"],
                          a.forecast.map((f) => [fmtLocal(f.t), f.pred, f.band[0], f.band[1], f.temp]),
                        ),
                      )
                    }
                  >
                    ↓ Excel
                  </button>
                </div>
              }
            >
              <div className="chart tall">
                <ResponsiveContainer>
                  <ComposedChart data={chartData.merged} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
                    <CartesianGrid {...s.grid} />
                    <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} ticks={chartData.ticks} tickFormatter={(v) => fmtDay(v)} {...s.axis} />
                    <YAxis {...s.axis} width={52} domain={["auto", "auto"]} />
                    {chartData.forecastStart && <ReferenceLine x={chartData.forecastStart} stroke={c.muted} strokeDasharray="3 3" />}
                    <Tooltip
                      {...s.tooltip}
                      labelFormatter={(l) => fmtDateTime(Number(l))}
                      formatter={(v, n) => [Array.isArray(v) ? `${fmt(Number(v[0]), 1)} – ${fmt(Number(v[1]), 1)} ${unit}` : `${fmt(Number(v), 2)} ${unit}`, n]}
                    />
                    <Area dataKey="band" name="80% interval" stroke="none" fill={c["c-band"]} fillOpacity={0.25} isAnimationActive={false} />
                    <Line dataKey="actual" name="Actual" stroke={c["c-load"]} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    <Line dataKey="pred" name="Forecast" stroke={c.accent} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <LegendItems
                items={[
                  { label: "Actual", color: c["c-load"], line: true },
                  { label: "Forecast", color: c.accent, line: true },
                  { label: "80 % interval", color: c["c-band"] },
                ]}
              />
            </Card>

            <div className="grid cols-2">
              <Card title="Back-test: last week out-of-sample" subtitle="Model trained without these hours vs. seasonal-naive benchmark">
                <div className="chart">
                  <ResponsiveContainer>
                    <ComposedChart data={a.holdout} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
                      <CartesianGrid {...s.grid} />
                      <XAxis dataKey="t" type="number" scale="time" domain={["dataMin", "dataMax"]} ticks={dayTicks(a.holdout.map((h) => h.t))} tickFormatter={(v) => fmtDay(v)} {...s.axis} />
                      <YAxis {...s.axis} width={52} domain={["auto", "auto"]} />
                      <Tooltip {...s.tooltip} labelFormatter={(l) => fmtDateTime(Number(l))} formatter={(v, n) => [`${fmt(Number(v), 2)} ${unit}`, n]} />
                      <Line dataKey="actual" name="Actual" stroke={c["c-load"]} strokeWidth={1.6} dot={false} isAnimationActive={false} />
                      <Line dataKey="naive" name="Naive" stroke={c.faint} strokeWidth={1.2} strokeDasharray="3 3" dot={false} isAnimationActive={false} />
                      <Line dataKey="model" name="Model" stroke={c.accent} strokeWidth={1.8} dot={false} isAnimationActive={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <LegendItems
                  items={[
                    { label: "Actual", color: c["c-load"], line: true },
                    { label: `Model · MAPE ${fmt(a.metrics.mape, 2)} %`, color: c.accent, line: true },
                    { label: `Naive · MAPE ${fmt(a.metrics.naiveMape, 2)} %`, color: c.faint, line: true },
                  ]}
                />
              </Card>

              <Card title="Temperature sensitivity" subtitle={`Daily mean load vs. daily mean temperature (${cityName})`}>
                <div className="chart">
                  <ResponsiveContainer>
                    <ScatterChart margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
                      <CartesianGrid {...s.grid} vertical />
                      <XAxis dataKey="temp" type="number" name="Temperature" unit=" °C" domain={["auto", "auto"]} {...s.axis} />
                      <YAxis dataKey="load" type="number" name="Load" width={52} domain={["auto", "auto"]} {...s.axis} />
                      <Tooltip {...s.tooltip} formatter={(v, n) => [fmt(Number(v), 2), n]} />
                      <ReferenceLine x={15} stroke={c.faint} strokeDasharray="3 3" label={{ value: "15 °C heating base", fill: c.faint, fontSize: 11, position: "insideTopRight" }} />
                      <Scatter data={a.daily} fill={c["c-temp"]} fillOpacity={0.7} isAnimationActive={false} />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

            <div className="grid cols-2">
              <Card title="Typical week" subtitle={`Average load by weekday and hour (${unit})`}>
                <Heatmap data={a.heatmap} colors={c} unit={unit} />
              </Card>
              <Card
                title="Detected anomalies"
                subtitle="Hours where |actual − model| > 3σ of residuals"
                actions={a.anomalies.length > 0 ? <AskButton question="Go through the detected anomalies and suggest plausible root causes and follow-up checks for the grid operator." label="Diagnose" /> : undefined}
              >
                {a.anomalies.length === 0 ? (
                  <p className="muted small">No anomalies above 3σ found.</p>
                ) : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th className="num">Actual</th>
                          <th className="num">Expected</th>
                          <th className="num">z-score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {a.anomalies.slice(0, 10).map((x) => (
                          <tr key={x.t}>
                            <td>{fmtDateTime(x.t)}</td>
                            <td className="num">{fmt(x.actual, 1)}</td>
                            <td className="num">{fmt(x.expected, 1)}</td>
                            <td className={`num ${x.z > 0 ? "tone-bad" : ""}`} style={x.z < 0 ? { color: c["c-wind"] } : undefined}>
                              {x.z > 0 ? "+" : ""}
                              {fmt(x.z, 1)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>

            <Card title="Method">
              <div className="method">
                <p>
                  <strong>Model:</strong> ridge regression on 168 hour-of-week dummies (NRW public holidays and 24/31 Dec mapped to
                  Sunday) plus heating degree hours <code>max(0, 15 − T)</code>, a daytime heating interaction and cooling degree hours{" "}
                  <code>max(0, T − 22)</code>. Temperatures from Open-Meteo (ERA5 archive + forecast) for the selected location.
                </p>
                <p>
                  <strong>Validation:</strong> the most recent week is held out; accuracy is reported as MAPE and as skill relative to a
                  seasonal-naive forecast (same hour last week). The forecast uses the full history and NWP temperatures; the band is
                  ±1.28σ of in-sample residuals, widened with horizon.
                </p>
                <p>
                  <strong>Next steps for production:</strong> gradient boosting with lagged features, school holidays, solar irradiance
                  for prosumer-heavy grids, and probabilistic evaluation (pinball loss).
                </p>
              </div>
            </Card>
          </div>
        </>
      )}
    </>
  );
}

function Heatmap({ data, colors, unit }: { data: number[][]; colors: ThemeColors; unit: string }) {
  const flat = data.flat().filter(Number.isFinite);
  const min = Math.min(...flat);
  const max = Math.max(...flat);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <div>
      <div className="heatmap">
        <span />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="cl">
            {h % 3 === 0 ? h : ""}
          </span>
        ))}
        {data.map((row, d) => (
          <FragmentRow key={d} label={days[d]}>
            {row.map((v, h) => {
              const x = Number.isFinite(v) ? (v - min) / (max - min || 1) : 0;
              return (
                <span
                  key={h}
                  className="cell"
                  title={`${days[d]} ${h}:00 — ${fmt(v, 2)} ${unit}`}
                  style={{ background: colors.accent, opacity: 0.12 + 0.88 * x }}
                />
              );
            })}
          </FragmentRow>
        ))}
      </div>
      <div className="legend" style={{ justifyContent: "space-between" }}>
        <span>low {fmt(min, 1)} {unit}</span>
        <span>high {fmt(max, 1)} {unit}</span>
      </div>
    </div>
  );
}

function FragmentRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="rl">{label}</span>
      {children}
    </>
  );
}

function fmtLocal(t: number) {
  const p = berlinParts(t);
  return `${p.date} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

function dailyAvg(pts: Pt[]) {
  const m = new Map<string, { s: number; n: number; max: number }>();
  pts.forEach((p) => {
    const d = fmtDay(p.t);
    const a = m.get(d) ?? { s: 0, n: 0, max: -Infinity };
    a.s += p.v;
    a.n += 1;
    a.max = Math.max(a.max, p.v);
    m.set(d, a);
  });
  return [...m].map(([day, a]) => ({ day, avg: round(a.s / a.n, 2), peak: round(a.max, 2) }));
}
