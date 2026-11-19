"use client";

import { useEffect, useState } from "react";

const KEYS = ["c-solar", "c-wind", "c-load", "c-price", "c-resid", "c-good", "c-bad", "c-band", "c-temp", "grid", "muted", "faint", "text", "surface", "border", "accent"] as const;
type Key = (typeof KEYS)[number];
export type ThemeColors = Record<Key, string>;

const DEFAULTS: ThemeColors = {
  "c-solar": "#e3a008",
  "c-wind": "#2f76d2",
  "c-load": "#334155",
  "c-price": "#7c3aed",
  "c-resid": "#d4553a",
  "c-good": "#15803d",
  "c-bad": "#c2410c",
  "c-band": "#94a3b8",
  "c-temp": "#0891b2",
  grid: "#e5e9ee",
  muted: "#5a6577",
  faint: "#8a94a5",
  text: "#0e1726",
  surface: "#ffffff",
  border: "#dde3e9",
  accent: "#0b7a5f",
};

/** Resolve CSS color tokens to concrete values for SVG charts (re-reads on theme change). */
export function useThemeColors(): ThemeColors {
  const [colors, setColors] = useState<ThemeColors>(DEFAULTS);
  useEffect(() => {
    const read = () => {
      const s = getComputedStyle(document.documentElement);
      const next = { ...DEFAULTS };
      KEYS.forEach((k) => {
        const v = s.getPropertyValue(`--${k}`).trim();
        if (v) next[k] = v;
      });
      setColors(next);
    };
    read();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", read);
    return () => mq.removeEventListener("change", read);
  }, []);
  return colors;
}

export function useJson<T>(url: string | null): { data: T | null; error: string | null; loading: boolean } {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: !!url,
  });
  useEffect(() => {
    if (!url) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    fetch(url)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body?.error ?? `HTTP ${r.status}`);
        return body as T;
      })
      .then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((e: Error) => alive && setState({ data: null, error: e.message, loading: false }));
    return () => {
      alive = false;
    };
  }, [url]);
  return state;
}

/** Shared Recharts styling. */
export function chartStyles(c: ThemeColors) {
  return {
    axis: { stroke: c.faint, fontSize: 11.5, tickLine: false, axisLine: { stroke: c.border } },
    grid: { stroke: c.grid, strokeDasharray: "0", vertical: false },
    tooltip: {
      contentStyle: {
        background: c.surface,
        border: `1px solid ${c.border}`,
        borderRadius: 10,
        fontSize: 12.5,
        color: c.text,
        boxShadow: "0 6px 20px rgba(0,0,0,0.12)",
      },
      labelStyle: { color: c.muted, marginBottom: 4 },
      itemStyle: { padding: 0 },
    },
  };
}
