"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { useI18n } from "@/lib/client/i18n";
import { play } from "@/lib/client/sound";
import { GelButton, RubberStamp } from "@/components/skeuo";
import { toast } from "@/components/Toasts";
import { WIZARD_STEPS } from "@/components/Conveyor";
import type { TeacherView } from "@/lib/client/useTeacher";

export default function StaffRoom() {
  const { t, tm, n, lang } = useI18n();
  const router = useRouter();
  const [teachers, setTeachers] = useState<TeacherView[] | null>(null);
  const [live, setLive] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ teachers: TeacherView[] }>("/api/teachers").then((d) => setTeachers(d.teachers)).catch((e) => toast(tm(e.message), "error"));
    api<{ live: boolean }>("/api/status").then((s) => setLive(s.live)).catch(() => {});
  }, [tm]);

  const create = async (template?: "saudi_history") => {
    setBusy(true);
    try {
      const { teacher } = await api<{ teacher: TeacherView }>("/api/teachers", { method: "POST", json: { lang, template } });
      play("boot");
      // A ready-made teacher is already built and programmed: go straight to giving it books.
      router.push(template ? `/subject/${teacher.id}` : `/workshop/${teacher.id}?tab=build`);
    } catch (e) { toast(tm((e as Error).message), "error"); setBusy(false); }
  };

  const hrefFor = (x: TeacherView) => (x.draft ? WIZARD_STEPS[Math.min(4, Math.max(0, x.wizard_step - 1))].href(x.id) : `/classroom/${x.id}`);
  const list = teachers ?? [];
  const perShelf = 4;
  const slots: (TeacherView | "new" | "empty")[] = ["new", ...list];
  if (list.length === 0) slots.push("empty");
  const shelves: typeof slots[] = [];
  for (let i = 0; i < slots.length; i += perShelf) shelves.push(slots.slice(i, i + perShelf));

  return (
    <main className="page">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <h1 className="page-title emboss">{t("Staff Room")}</h1>
        <Link className="metal-button" href="/styleguide">{t("Style guide")}</Link>
      </div>

      <section className="notice-board cork" style={{ marginBottom: 34 }}>
        <div className="row" style={{ gap: 18, alignItems: "flex-start" }}>
          <div className="sticky-note" style={{ cursor: "default" }}>
            <b>{t("How it works")}</b><br />{t("1. Build & dress a robot")}<br />{t("2. Program its personality")}<br />{t("3. Give it a subject + your books")}<br />{t("4. Learn in the Classroom!")}
          </div>
          <div className="sticky-note" style={{ cursor: "default" }}>
            <b>{t("Topic Library")}</b><br />{t("Books are filed once into topic cards. Two books about “Mammals”? Still ONE card. Answers read only the cards they need.")}
          </div>
          <div className="sticky-note national-day" style={{ cursor: "default" }}>
            <b>{t("Happy Saudi National Day! 🇸🇦")}</b><br />{t("Every year, may our homeland be well 💚")}
          </div>
          {!live && (
            <div className="sticky-note" style={{ cursor: "default" }}>
              <b>{t("Demo mode")}</b><br />{t("No API key found. Everything works offline, but answers are quoted notes. Add GEMINI_API_KEY (free) or ANTHROPIC_API_KEY to .env.local for real AI teachers.")}
            </div>
          )}
          <div className="grow" />
          <RubberStamp color="#2e7d4f">{t("UEBAI v1")}</RubberStamp>
        </div>
      </section>

      <div className="shelf-wall">
        {teachers === null && <p className="hand center">{t("Unpacking robots…")}</p>}
        {teachers !== null && shelves.map((shelf, si) => (
          <div className="shelf" key={si}>
            {shelf.map((s) => {
              if (s === "new") return (
                <div key="new" className="robot-pod pod-empty" style={{ cursor: "default" }}>
                  <div />
                  <div className="stack center" style={{ alignContent: "center", justifyItems: "center" }}>
                    <span style={{ fontSize: 56 }} aria-hidden>🛠️</span>
                    <GelButton color="green" size="lg" onClick={() => create()} disabled={busy} style={{ whiteSpace: "normal", maxWidth: "100%", lineHeight: 1.2 }}>{busy ? "…" : `+ ${t("Make New Teacher")}`}</GelButton>
                    <GelButton color="teal" size="sm" onClick={() => create("saudi_history")} disabled={busy} style={{ whiteSpace: "normal", maxWidth: "100%", lineHeight: 1.2 }}>🇸🇦 {t("Saudi history teacher (ready-made)")}</GelButton>
                  </div>
                  <div />
                </div>
              );
              if (s === "empty") return (
                <div key="empty" className="robot-pod pod-empty" style={{ cursor: "default" }}>
                  <div />
                  <div className="sticky-note" style={{ alignSelf: "center" }}>{t("Your first teacher goes here!")}</div>
                  <div />
                </div>
              );
              return (
                <Link key={s.id} href={hrefFor(s)} className="robot-pod" onMouseEnter={() => play("pop")} onClick={() => play("click")}>
                  {s.draft && <span className="draft-tag"><RubberStamp color="#b8622a">{t("Draft")}</RubberStamp></span>}
                  <span className="last-studied">{t("Last studied")}: {s.last_topic_title ?? t("Nothing yet")}</span>
                  <div />
                  <div className="pod-canvas">
                    {s.avatar_url
                      ? <img src={s.avatar_url} alt={`${s.title} ${s.name}`} />
                      : <div className="center" style={{ fontSize: 110, lineHeight: "200px", animation: "bob 3s ease-in-out infinite" }} aria-hidden>🤖</div>}
                  </div>
                  <div className="pod-base brushed-metal">
                    <div className="pod-name emboss">{s.title} {s.name}</div>
                    <div className="pod-sub emboss">{s.subject.name || "—"} · {t("{n} topics", { n: n(s.topic_count) })}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </main>
  );
}
