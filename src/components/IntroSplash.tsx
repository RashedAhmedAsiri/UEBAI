"use client";
import { useEffect, useState } from "react";
import { play } from "@/lib/client/sound";
import type { Lang } from "@/lib/i18n/translate";

const TEXT = {
  ar: { by: "صُنع بواسطة:", name: "راشد عسيري" },
  en: { by: "made by:", name: "Rashed Aseri" },
};

/** 1-second opening animation: a brass plaque drops in, letters pop, a shine sweeps, then it fades. */
export function IntroSplash({ lang }: { lang: Lang }) {
  const [show, setShow] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setShow(false), 1000);
    // Browsers only allow audio after a gesture; try anyway, silently.
    try { play("boot"); } catch { /* autoplay blocked */ }
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;
  const txt = TEXT[lang];
  // Arabic letters must stay joined, so Arabic animates word by word; English letter by letter.
  const pieces = lang === "ar" ? txt.name.split(" ") : txt.name.split("");
  return (
    <div className="intro-splash" role="presentation" aria-label={`${txt.by} ${txt.name}`}>
      <div className="intro-plaque">
        <span className="screw l" /><span className="screw r" />
        <span className="intro-bot" aria-hidden>🤖</span>
        <div className="intro-by">{txt.by}</div>
        <div className="intro-name" dir={lang === "ar" ? "rtl" : "ltr"}>
          {pieces.map((p, i) => (
            <span key={i} style={{ animationDelay: `${120 + i * (lang === "ar" ? 140 : 28)}ms` }}>
              {p === " " ? " " : p}{lang === "ar" && i < pieces.length - 1 ? " " : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
