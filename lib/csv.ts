import { berlinLocalToUtc } from "./time";
import type { Pt } from "./loadModel";

/**
 * Parse a load profile export. Accepts typical utility formats:
 *   2025-01-01T00:00:00Z,123.4
 *   2025-01-01 00:15;123,4
 *   01.01.2025 00:15;123,4
 *   01.01.2025;00:15;123,4        (date and time in separate columns)
 * Naive timestamps are interpreted as Europe/Berlin local time.
 */
export function parseLoadCsv(text: string): { points: Pt[]; skipped: number } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const sample = lines.slice(0, 20).join("\n");
  const delim = sample.includes(";") ? ";" : sample.includes("\t") ? "\t" : ",";
  const points: Pt[] = [];
  let skipped = 0;

  for (const line of lines) {
    const cols = line.split(delim).map((c) => c.trim().replace(/^"|"$/g, ""));
    if (cols.length < 2) {
      skipped++;
      continue;
    }
    let tsStr = cols[0];
    let valStr = cols[1];
    if (/^\d{1,2}:\d{2}/.test(cols[1]) && cols.length >= 3) {
      tsStr = `${cols[0]} ${cols[1]}`;
      valStr = cols[2];
    }
    const t = parseTimestamp(tsStr);
    const v = parseNumber(valStr, delim === ";");
    if (t === null || !Number.isFinite(v)) {
      skipped++;
      continue;
    }
    points.push({ t, v });
  }
  points.sort((a, b) => a.t - b.t);
  return { points, skipped };
}

function parseNumber(s: string, europeanDefault: boolean): number {
  let x = s.replace(/\s/g, "");
  if (x.includes(",") && (europeanDefault || !x.includes("."))) {
    x = x.replace(/\./g, "").replace(",", ".");
  }
  return x === "" ? NaN : Number(x);
}

export function parseTimestamp(s: string): number | null {
  if (!s) return null;
  // ISO with explicit zone
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const t = Date.parse(s.replace(" ", "T"));
    return Number.isFinite(t) ? t : null;
  }
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (m) return berlinLocalToUtc(+m[1], +m[2], +m[3], +(m[4] ?? 0), +(m[5] ?? 0));
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return berlinLocalToUtc(+m[3], +m[2], +m[1], +(m[4] ?? 0), +(m[5] ?? 0));
  return null;
}

/** CSV for German Excel: semicolon separator, decimal comma. */
export function toExcelCsv(header: string[], rows: (string | number)[][]): string {
  const cell = (c: string | number) => (typeof c === "number" ? (Number.isFinite(c) ? c.toFixed(3).replace(".", ",") : "") : c);
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
}

export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
