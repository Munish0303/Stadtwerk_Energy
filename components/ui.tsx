"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { DataSource } from "@/lib/types";
import { useCopilot } from "./CopilotProvider";

export function PageHeader({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: string;
  lead?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
      </div>
      {children && <div className="row">{children}</div>}
    </div>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({
  label,
  value,
  unit,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  hint?: ReactNode;
  tone?: "good" | "bad";
}) {
  return (
    <div className="card kpi">
      <div className="label">{label}</div>
      <div className={`value ${tone ? `tone-${tone}` : ""}`}>
        {value}
        {unit && <span className="unit">{unit}</span>}
      </div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      className="input"
      type="number"
      inputMode="decimal"
      value={text}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(v) && (min === undefined || v >= min) && (max === undefined || v <= max)) onChange(v);
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

export function Loading({ label = "Loading data…" }: { label?: string }) {
  return (
    <div className="loading">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function SourceBadge({ source, label }: { source: DataSource; label: string }) {
  return (
    <span className={`badge ${source === "synthetic" ? "warn" : ""}`}>
      <span className="dot" />
      {source === "live" ? label : "Synthetic demo data"}
    </span>
  );
}

export function AskButton({ question, label = "Ask Copilot" }: { question: string; label?: string }) {
  const { ask } = useCopilot();
  return (
    <button className="btn small" onClick={() => ask(question)} title={question}>
      ✦ {label}
    </button>
  );
}

export function LegendItems({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <i style={{ background: i.color, height: i.line ? 3 : 10, borderRadius: i.line ? 2 : 3 }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}
