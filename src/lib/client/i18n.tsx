"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { safeStorage } from "./api";
import { setSoundEnabled } from "./sound";
import { formatNumber, LANG_COOKIE, translate, translateMessage, type Lang, type Vars } from "@/lib/i18n/translate";

export type { Lang } from "@/lib/i18n/translate";

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Translate a UI string (English key → Arabic by default). */
  t: (s: string, vars?: Vars) => string;
  /** Translate a message that came from the server. */
  tm: (s: string) => string;
  /** Pick the right side of a {en, ar} catalog name. */
  L: (x: { en: string; ar: string }) => string;
  n: (x: number) => string;
  dir: "ltr" | "rtl";
  sound: boolean;
  setSound: (v: boolean) => void;
}

const Ctx = createContext<I18n>({
  lang: "ar", setLang: () => {}, t: (s) => s, tm: (s) => s, L: (x) => x.ar, n: (x) => String(x), dir: "rtl", sound: true, setSound: () => {},
});

export function I18nProvider({ children, initialLang }: { children: ReactNode; initialLang: Lang }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const [sound, setSoundState] = useState(true);
  useEffect(() => {
    if (safeStorage().get("roboprof.sound") === "off") { setSoundState(false); setSoundEnabled(false); }
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.title = lang === "ar" ? "UEBAI — اصنع معلّمك الآلي" : "UEBAI — Build Your Own AI Teacher";
  }, [lang]);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
  }, []);
  const setSound = useCallback((v: boolean) => { setSoundState(v); setSoundEnabled(v); safeStorage().set("roboprof.sound", v ? "on" : "off"); }, []);
  const t = useCallback((s: string, vars?: Vars) => translate(lang, s, vars), [lang]);
  const tm = useCallback((s: string) => translateMessage(lang, s), [lang]);
  const L = useCallback((x: { en: string; ar: string }) => x[lang], [lang]);
  const n = useCallback((x: number) => formatNumber(lang, x), [lang]);
  return (
    <Ctx.Provider value={{ lang, setLang, t, tm, L, n, dir: lang === "ar" ? "rtl" : "ltr", sound, setSound }}>
      {children}
    </Ctx.Provider>
  );
}

export const useI18n = () => useContext(Ctx);
