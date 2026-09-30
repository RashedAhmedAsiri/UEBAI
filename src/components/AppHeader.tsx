"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/client/i18n";
import { play } from "@/lib/client/sound";

export function AppHeader() {
  const { t, lang, setLang, sound, setSound } = useI18n();
  const [live, setLive] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then((s) => setLive(Boolean(s.live))).catch(() => setLive(null));
  }, []);
  return (
    <header className="app-header brushed-metal">
      <Link href="/" className="logo emboss" onClick={() => play("click")}>
        {t("UEBAI")}
      </Link>
      {live === false && (
        <span className="demo-badge" data-tip={t("No API key — add GEMINI_API_KEY (free) or ANTHROPIC_API_KEY to .env.local")}>{t("Demo mode")}</span>
      )}
      <span className="spacer" />
      <nav className="header-group" aria-label={t("Staff Room")}>
        <Link href="/" className="metal-button">🏠 {t("Staff Room")}</Link>
        <Link href="/bench" className="metal-button">🔬 {t("Proof Lab")}</Link>
      </nav>
      <span className="header-divider" aria-hidden />
      <div className="header-group">
        {/* Sound switch sits on its own recessed plate so its status light never touches other buttons. */}
        <div className="sound-plate">
          <span aria-hidden>{sound ? "🔊" : "🔈"}</span>
          <label className="metal-toggle" title={t("Sound")}>
            <input type="checkbox" checked={sound} onChange={(e) => { setSound(e.target.checked); if (e.target.checked) play("clunk"); }} aria-label={t("Sound")} />
            <span className="plate"><span className="lever-knob" /></span>
          </label>
        </div>
        {/* Language switch: Arabic is the main language; English is the optional translation. */}
        <button className="metal-button" onClick={() => { play("clunk"); setLang(lang === "ar" ? "en" : "ar"); }} aria-label={t("Switch language")}>
          🌐 {lang === "ar" ? "الإنجليزية" : "Arabic"}
        </button>
      </div>
    </header>
  );
}
