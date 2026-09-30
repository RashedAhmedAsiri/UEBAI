"use client";
import Link from "next/link";
import { useI18n } from "@/lib/client/i18n";
import { play } from "@/lib/client/sound";

export const WIZARD_STEPS = [
  { n: 1, name: "Build", href: (id: string) => `/workshop/${id}?tab=build`, icon: "🔧" },
  { n: 2, name: "Dress", href: (id: string) => `/workshop/${id}?tab=dress`, icon: "👔" },
  { n: 3, name: "Program", href: (id: string) => `/personality/${id}`, icon: "🧠" },
  { n: 4, name: "Assign", href: (id: string) => `/subject/${id}`, icon: "📚" },
  { n: 5, name: "Power On", href: (id: string) => `/poweron/${id}`, icon: "⚡" },
];

/** Factory conveyor belt with 5 stations; the little robot rides to the current one. */
export function Conveyor({ id, current, reached }: { id: string; current: number; reached: number }) {
  const { t, dir } = useI18n();
  const pos = ((current - 0.5) / WIZARD_STEPS.length) * 100;
  return (
    <nav className="conveyor brushed-metal rivets" aria-label={t("Wizard steps")}>
      <div className="stations">
        {WIZARD_STEPS.map((s) => {
          const cls = s.n === current ? "current" : s.n < current || s.n <= reached ? "done" : "";
          return (
            <Link key={s.n} href={s.href(id)} className={`station ${cls}`} onClick={() => play("clunk")} aria-current={s.n === current ? "step" : undefined}>
              <span className="lamp" />
              <span aria-hidden>{s.icon}</span>
              <span className="name emboss">{t(s.name)}</span>
            </Link>
          );
        })}
      </div>
      <div className="belt" />
      <span className="bot" style={{ insetInlineStart: `calc(14px + (100% - 28px) * ${pos / 100})`, transform: dir === "rtl" ? "scaleX(-1)" : undefined }} aria-hidden>🤖</span>
    </nav>
  );
}
