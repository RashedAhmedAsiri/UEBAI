"use client";
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import Link from "next/link";
import { play, type SoundName } from "@/lib/client/sound";
import { useI18n } from "@/lib/client/i18n";

type Color = "red" | "green" | "blue" | "yellow" | "purple" | "orange" | "teal";

export function GelButton({ color = "blue", size, sound = "click", className = "", onClick, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { color?: Color; size?: "xs" | "sm" | "lg" | "xl"; sound?: SoundName }) {
  return (
    <button
      {...rest}
      className={`gel-button gel-${color} ${size ? `gel-${size}` : ""} ${className}`}
      onClick={(e) => { play(sound); onClick?.(e); }}
    />
  );
}

export function GelLink({ href, color = "blue", size, children }: { href: string; color?: Color; size?: "xs" | "sm" | "lg" | "xl"; children: ReactNode }) {
  return <Link href={href} className={`gel-button gel-${color} ${size ? `gel-${size}` : ""}`} onClick={() => play("click")}>{children}</Link>;
}

export function MetalButton({ className = "", onClick, active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return <button {...rest} className={`metal-button ${active ? "active" : ""} ${className}`} onClick={(e) => { play("clunk"); onClick?.(e); }} />;
}

export function MetalToggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="metal-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => { play("clunk"); onChange(e.target.checked); }} />
      <span className="plate"><span className="lever-knob" /></span>
      <span>{label}</span>
    </label>
  );
}

export function Fader({ label, value, min = 0, max = 10, step = 1, onChange, format }: { label: ReactNode; value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  const last = useRef(value);
  return (
    <div className="fader">
      <label>
        <span>{label}</span>
        <output>{format ? format(value) : value}</output>
      </label>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Math.abs(v - last.current) >= step) { play("tick"); last.current = v; }
          onChange(v);
        }}
      />
    </div>
  );
}

/** Rotary knob: drag up/down or use arrow keys. Sweep −135°..+135°. */
export function Knob({ label, value, min, max, step = 0.05, onChange, format }: { label: ReactNode; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  const drag = useRef<{ y: number; v: number } | null>(null);
  const frac = (value - min) / (max - min);
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)) / step) * step;
  return (
    <div className="knob-wrap">
      <div
        className="knob" role="slider" tabIndex={0} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} aria-label={typeof label === "string" ? label : undefined}
        style={{ transform: `rotate(${-135 + frac * 270}deg)` }}
        onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { y: e.clientY, v: value }; }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const nv = clamp(drag.current.v + ((drag.current.y - e.clientY) / 150) * (max - min));
          if (nv !== value) { play("tick"); onChange(Number(nv.toFixed(3))); }
        }}
        onPointerUp={() => { drag.current = null; }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp" || e.key === "ArrowRight") { e.preventDefault(); onChange(Number(clamp(value + step).toFixed(3))); play("tick"); }
          if (e.key === "ArrowDown" || e.key === "ArrowLeft") { e.preventDefault(); onChange(Number(clamp(value - step).toFixed(3))); play("tick"); }
        }}
      >
        <span className="indicator" />
      </div>
      <span>{label}</span>
      <span className="knob-scale">{format ? format(value) : value.toFixed(2)}</span>
    </div>
  );
}

export function Lever<T extends string>({ options, value, onChange }: { options: { value: T; label: string; emoji: string }[]; value: T; onChange: (v: T) => void }) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className="lever" role="radiogroup">
      <div className="slot" />
      <div className="handle" style={{ insetInlineStart: `calc(16px + (100% - 32px) * ${(idx + 0.5) / options.length})` }} />
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === value} onClick={() => { play("clunk"); onChange(o.value); }}>
          <span className="emoji">{o.emoji}</span>{o.label}
        </button>
      ))}
    </div>
  );
}

export function TubeProgress({ pct, label }: { pct: number; label?: string }) {
  const { n, lang } = useI18n();
  return (
    <div className="tube" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className="liquid" style={{ width: `calc(${Math.max(4, Math.min(100, pct))}% - 6px)` }} />
      <div className="shine" />
      <div className="label">{label ?? `${n(Math.round(pct))}${lang === "ar" ? "٪" : "%"}`}</div>
    </div>
  );
}

export function BrassPlaque({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <div className="brass-plaque">
      <span className="screw l" /><span className="screw r" />
      <span className="value">{value}</span>
      <span className="label">{label}</span>
    </div>
  );
}

/** Analog VU meter: needle shows answer tokens as a share of the whole book (log scale). */
export function VuGauge({ used, baseline, label }: { used: number; baseline: number; label?: string }) {
  const { t, n, dir } = useI18n();
  const [shown, setShown] = useState(0);
  const frac = baseline > 0 ? Math.min(1, Math.log10(1 + used) / Math.log10(1 + baseline)) : used > 0 ? 0.5 : 0;
  useEffect(() => { const t = setTimeout(() => setShown(frac), 60); return () => clearTimeout(t); }, [frac]);
  const angle = -60 + shown * 120;
  const ticks = Array.from({ length: 13 }, (_, i) => -60 + i * 10);
  return (
    <div className="gauge-wrap">
      <svg className="vu" viewBox="0 0 240 140" role="img" aria-label={t("{used} tokens of {baseline}", { used: n(used), baseline: n(baseline) })} style={{ direction: "ltr" }}>
        <defs>
          <linearGradient id="vuface" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff8de" /><stop offset="1" stopColor="#f1e1b0" /></linearGradient>
          <linearGradient id="vubezel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f4f5f6" /><stop offset="1" stopColor="#6c7378" /></linearGradient>
          <filter id="vushadow"><feDropShadow dx="1" dy="2" stdDeviation="1.2" floodOpacity=".45" /></filter>
        </defs>
        <rect x="2" y="2" width="236" height="136" rx="12" fill="url(#vubezel)" />
        <rect x="10" y="10" width="220" height="120" rx="6" fill="url(#vuface)" stroke="#8a7a50" />
        <path d="M 40 110 A 90 90 0 0 1 200 110" fill="none" stroke="#2b2118" strokeWidth="1.5" transform="translate(0,-8)" />
        <path d="M 160 38 A 90 90 0 0 1 200 102" fill="none" stroke="#d11c1c" strokeWidth="5" opacity=".75" />
        {ticks.map((a, i) => {
          const r1 = 84, r2 = i % 3 === 0 ? 72 : 77;
          const rad = (a - 90) * (Math.PI / 180);
          return <line key={a} x1={120 + r1 * Math.cos(rad)} y1={118 + r1 * Math.sin(rad)} x2={120 + r2 * Math.cos(rad)} y2={118 + r2 * Math.sin(rad)} stroke="#2b2118" strokeWidth={i % 3 === 0 ? 2 : 1} />;
        })}
        <text x="120" y="98" textAnchor="middle" style={{ fontFamily: "var(--font-type)" }} fontSize="13" fill="#6b5a3a">{label ?? t("Tokens")}</text>
        <text x="28" y="124" style={{ fontFamily: "var(--font-type)" }} fontSize="9" fill="#2b2118">{n(0)}</text>
        <text x="200" y="124" textAnchor="middle" style={{ fontFamily: "var(--font-type)" }} fontSize="9" fill="#b3202a" direction={dir}>{t("Whole book")}</text>
        <g transform={`rotate(${angle} 120 118)`} style={{ transition: "transform 1s cubic-bezier(.3,1.6,.5,1)" }} filter="url(#vushadow)">
          <line x1="120" y1="118" x2="120" y2="34" stroke="#b3202a" strokeWidth="3" strokeLinecap="round" />
        </g>
        <circle cx="120" cy="118" r="8" fill="#2b2118" />
        <circle cx="118" cy="116" r="2.5" fill="#888" />
      </svg>
    </div>
  );
}

const modalStack: (() => void)[] = [];

export function FolderModal({ tab, onClose, children, wide }: { tab: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    play("paper");
    // Escape closes only the top-most folder.
    const entry = () => close.current();
    modalStack.push(entry);
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && modalStack[modalStack.length - 1] === entry) entry(); };
    window.addEventListener("keydown", k);
    return () => { window.removeEventListener("keydown", k); modalStack.splice(modalStack.indexOf(entry), 1); };
  }, []);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="folder-modal manila" data-tab={tab} role="dialog" aria-modal="true" aria-label={tab} style={wide ? { width: "min(1100px, 100%)" } : undefined}>
        <button className="metal-button modal-close" onClick={onClose} aria-label={t("Close")}>✕</button>
        <div className="folder-paper paper">{children}</div>
      </div>
    </div>
  );
}

export function RubberStamp({ children, color = "#b3202a", animate }: { children: ReactNode; color?: string; animate?: boolean }) {
  return <span className={`rubber-stamp ${animate ? "thunk" : ""}`} style={{ ["--sc" as string]: color }}>{children}</span>;
}

export function Screws() {
  return <><span className="screw" style={{ position: "absolute", top: 8, left: 8 }} /><span className="screw" style={{ position: "absolute", top: 8, right: 8 }} /><span className="screw" style={{ position: "absolute", bottom: 8, left: 8 }} /><span className="screw" style={{ position: "absolute", bottom: 8, right: 8 }} /></>;
}

/** CSS swatch approximating each robot material (used on texture chips). */
export function materialSwatch(material: string, tint = "#c9ced3"): string {
  const noise = "var(--tex-noise)";
  switch (material) {
    case "polished_chrome": return `linear-gradient(160deg, #fff 0%, #9aa1a7 30%, #f7f8f9 48%, #5e656b 70%, #d7dbde 100%)`;
    case "brushed_steel": return `${noise}, repeating-linear-gradient(90deg, #cfd3d6 0 1px, #b5bbc0 1px 2px), linear-gradient(#e3e6e8, #a9afb4)`;
    case "painted_enamel": return `${noise}, radial-gradient(circle at 80% 70%, #7a6a5a 0 3px, transparent 4px), linear-gradient(160deg, color-mix(in srgb, ${tint} 70%, white), ${tint})`;
    case "toy_plastic": return `linear-gradient(160deg, color-mix(in srgb, ${tint} 40%, white) 0%, ${tint} 40%, color-mix(in srgb, ${tint} 80%, black) 100%)`;
    case "copper": return `${noise}, linear-gradient(160deg, #f6c3a0, #b87333 45%, #7a3f16)`;
    case "brass": return `${noise}, linear-gradient(160deg, #f7e39a, #c9a24a 45%, #7d5f1e)`;
    case "gold": return `linear-gradient(160deg, #fff4c2, #f2c94c 40%, #b8860b 75%, #ffe38a)`;
    case "rusty_iron": return `${noise}, radial-gradient(circle at 30% 40%, #a0521d 0 6px, transparent 9px), radial-gradient(circle at 70% 70%, #8b4513 0 5px, transparent 8px), linear-gradient(#6b6e70, #45484a)`;
    case "wood_panel": return `${noise}, var(--tex-wood)`;
    case "carbon_fiber": return `repeating-linear-gradient(45deg, #222 0 3px, #3a3a3a 3px 6px), repeating-linear-gradient(-45deg, #0000 0 3px, #0004 3px 6px)`;
    case "rubber": return `${noise}, linear-gradient(#3d3f41, #202224)`;
    default: return tint;
  }
}
