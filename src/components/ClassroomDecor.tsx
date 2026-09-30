"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/client/i18n";

/** Ticking wall clock with the real time. */
export function WallClock() {
  const { lang } = useI18n();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return <div className="wall-clock" />;
  const s = now.getSeconds(), m = now.getMinutes() + s / 60, h = (now.getHours() % 12) + m / 60;
  return (
    <div className="wall-clock" role="img" aria-label={now.toLocaleTimeString(lang === "ar" ? "ar-SA" : "en-US")}>
      <span className="hand h" style={{ transform: `rotate(${h * 30}deg)` }} />
      <span className="hand m" style={{ transform: `rotate(${m * 6}deg)` }} />
      <span className="hand s" style={{ transform: `rotate(${s * 6}deg)` }} />
      <span className="pin" />
    </div>
  );
}

/** Classroom window: morning / day / sunset / night from the user's local time. */
export function ClassWindow() {
  const [hour, setHour] = useState<number | null>(null);
  useEffect(() => { setHour(new Date().getHours()); const t = setInterval(() => setHour(new Date().getHours()), 60_000); return () => clearInterval(t); }, []);
  const h = hour ?? 12;
  const phase = h >= 6 && h < 11 ? "morning" : h >= 11 && h < 17 ? "day" : h >= 17 && h < 19 ? "sunset" : "night";
  const sky = { morning: "linear-gradient(#9ed8ff, #fff1c9)", day: "linear-gradient(#3f9be8, #bfe6ff)", sunset: "linear-gradient(#5b3a8e, #ff8a4c 60%, #ffd27a)", night: "linear-gradient(#0b1030, #25306a)" }[phase];
  const sun = phase === "night" ? { background: "radial-gradient(circle at 35% 35%, #fffbe6, #d6d1b8)", top: 10, left: 70 } : { background: "radial-gradient(circle, #fff7c2, #ffc93c)", top: phase === "day" ? 8 : 34, left: phase === "morning" ? 12 : phase === "day" ? 42 : 70, boxShadow: "0 0 14px #ffd84d" };
  return (
    <div className="class-window" aria-hidden>
      <div className="sky" style={{ background: sky }} />
      <div className="sun" style={sun} />
      {phase === "night" && [8, 30, 52, 88, 20].map((x, i) => <span key={i} style={{ position: "absolute", left: x, top: 6 + (i * 13) % 50, width: 2, height: 2, background: "#fff", borderRadius: 1 }} />)}
      <div style={{ position: "absolute", left: -10, right: -10, bottom: -6, height: 22, background: phase === "night" ? "#10301c" : "#5aa845", borderRadius: "50% 50% 0 0" }} />
    </div>
  );
}

export function DustMotes({ count = 14 }: { count?: number }) {
  const [motes, setMotes] = useState<{ left: string; top: string; delay: string; dur: string }[]>([]);
  useEffect(() => {
    setMotes(Array.from({ length: count }, () => ({ left: `${40 + Math.random() * 55}%`, top: `${Math.random() * 60}%`, delay: `${-Math.random() * 9}s`, dur: `${7 + Math.random() * 6}s` })));
  }, [count]);
  return <>{motes.map((m, i) => <span key={i} className="dust" style={{ left: m.left, top: m.top, animationDelay: m.delay, animationDuration: m.dur }} />)}</>;
}
