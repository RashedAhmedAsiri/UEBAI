"use client";
import { useI18n } from "@/lib/client/i18n";
import { COND_COLOR } from "./labels";

export interface ChartRow { key: string; label: string; color: string; value: number; ci?: [number, number]; note?: string }

/** Horizontal bar chart (one bar per condition) with optional 95% CI whiskers. */
export function Chart({ title, hint, rows, fmt, max }: { title: string; hint: string; rows: ChartRow[]; fmt: (x: number) => string; max?: number }) {
  const top = max ?? Math.max(...rows.map((r) => (Number.isFinite(r.ci?.[1]) ? r.ci![1] : r.value)).filter(Number.isFinite), 0) * 1.05;
  const w = (x: number) => `${Math.max(0, Math.min(100, (x / (top || 1)) * 100))}%`;
  return (
    <div className="paper bench-chart">
      <div className="panel-title" style={{ marginBottom: 0 }}>{title}</div>
      <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{hint}</div>
      {rows.map((r) => (
        <div key={r.key} className="bench-bar-row">
          <span className="bench-bar-label">{r.label}</span>
          <span className="bench-bar-track">
            {Number.isFinite(r.value) && <span className="bench-bar" style={{ width: w(r.value), background: r.color }} />}
            {r.ci && Number.isFinite(r.ci[0]) && r.ci[1] > r.ci[0] && <span className="bench-ci" style={{ insetInlineStart: w(Math.max(0, r.ci[0])), width: `calc(${w(Math.min(top, r.ci[1]))} - ${w(Math.max(0, r.ci[0]))})` }} />}
          </span>
          <span className="bench-bar-value">{!Number.isFinite(r.value) && r.note ? <span style={{ color: "#b3202a", fontSize: 13 }}>✗ {r.note}</span> : fmt(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** "UEBAI: x / Whole book: y" on two lines, so the order never flips with text direction. */
export function Versus({ a, b }: { a: string; b: string }) {
  const { t } = useI18n();
  return (
    <span style={{ display: "grid", fontSize: "0.72em", lineHeight: 1.25, textAlign: "start" }}>
      <span><span style={{ color: COND_COLOR.uebai }}>●</span> {t("UEBAI cards")}: {a}</span>
      <span><span style={{ color: COND_COLOR.full }}>●</span> {t("Whole book")}: {b}</span>
    </span>
  );
}
