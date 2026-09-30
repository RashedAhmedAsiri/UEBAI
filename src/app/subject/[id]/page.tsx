"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTeacher } from "@/lib/client/useTeacher";
import { useI18n } from "@/lib/client/i18n";
import { THEME_PACKS } from "@/lib/catalog";
import { LEVELS, type KnowledgeMode, type Subject } from "@/lib/schemas";
import { Conveyor } from "@/components/Conveyor";
import { GelButton, Lever } from "@/components/skeuo";
import { SourcesTray } from "@/components/SourcesTray";
import { toast } from "@/components/Toasts";

const LEVEL_LABEL: Record<(typeof LEVELS)[number], string> = { elementary: "Elementary", middle: "Middle school", high_school: "High school", university: "University", adult: "Adult learner" };

export default function SubjectDesk({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { t, L, dir } = useI18n();
  const fwd = dir === "rtl" ? "←" : "→";
  const { teacher, patch, flush, reload } = useTeacher(id);
  const [s, setS] = useState<Subject | null>(null);

  useEffect(() => { if (teacher && !s) setS(teacher.subject); }, [teacher, s]);
  if (!teacher || !s) return <main className="page"><p className="hand center">{t("Tidying the desk…")}</p></main>;

  const update = (next: Subject) => { setS(next); void patch({ subject: next }); };
  const mode = teacher.knowledge_mode;

  const next = async () => {
    if (!s.name.trim()) { toast(t("Give your teacher a subject first!"), "error"); return; }
    await patch({ wizard_step: 5 }, true);
    await flush();
    router.push(`/poweron/${id}`);
  };

  return (
    <main className="page">
      {teacher.draft && <Conveyor id={id} current={4} reached={teacher.wizard_step} />}
      <h1 className="page-title emboss">{t("Subject Desk")}</h1>
      <div className="two-col">
        <section className="leather leather-panel stitched stack">
          <h2 className="deboss" style={{ fontSize: 26 }}>📇 {t("Subject card")}</h2>
          <div className="index-card" style={{ cursor: "default", padding: "14px 18px" }}>
            <h4>{s.name || "…"}</h4>
            <div className="stack" style={{ gap: 8 }}>
              <label className="field"><span>{t("Subject")}</span>
                <input className="typed-input" list="subjects" maxLength={80} value={s.name} placeholder={t("Biology")} onChange={(e) => update({ ...s, name: e.target.value })} />
                <datalist id="subjects">{Object.values(THEME_PACKS).map((p) => <option key={p.name.en} value={L(p.name)} />)}</datalist>
              </label>
              <label className="field"><span>{t("Course / book")}</span><input className="typed-input" maxLength={120} value={s.course} placeholder={t("Biology 1")} onChange={(e) => update({ ...s, course: e.target.value })} /></label>
              <div className="row">
                <label className="field grow"><span>{t("Student level")}</span>
                  <select className="typed-select" value={s.level} onChange={(e) => update({ ...s, level: e.target.value as Subject["level"] })}>
                    {LEVELS.map((l) => <option key={l} value={l}>{t(LEVEL_LABEL[l])}</option>)}
                  </select>
                </label>
                <label className="field grow"><span>{t("Materials language")}</span>
                  <select className="typed-select" value={s.materialsLanguage} onChange={(e) => update({ ...s, materialsLanguage: e.target.value as Subject["materialsLanguage"] })}>
                    <option value="ar">{t("Arabic")}</option><option value="en">{t("English")}</option><option value="mixed">{t("Mixed")}</option>
                  </select>
                </label>
              </div>
              <label className="field"><span>{t("Curriculum (optional)")}</span><input className="typed-input" maxLength={120} value={s.curriculum} placeholder={t("Saudi Ministry of Education · IB · AP · university course")} onChange={(e) => update({ ...s, curriculum: e.target.value })} /></label>
            </div>
          </div>

          <h2 className="deboss" style={{ fontSize: 26, marginTop: 8 }}>🎚️ {t("Knowledge mode")}</h2>
          <Lever<KnowledgeMode>
            value={mode}
            onChange={(v) => void patch({ knowledge_mode: v }, true)}
            options={[
              { value: "internet", label: t("Internet"), emoji: "🌐" },
              { value: "files_strict", label: t("My Files (strict)"), emoji: "📚" },
              { value: "files_first", label: t("Files first"), emoji: "📚🌐" },
            ]}
          />
          <p style={{ margin: 0, fontSize: 15 }}>
            {mode === "internet" && t("🌐 The teacher answers from general knowledge and can search the web.")}
            {mode === "files_strict" && t("📚 Answers ONLY from your uploaded materials. If something isn't covered, the teacher says so and suggests the closest topics.")}
            {mode === "files_first" && t("📚+🌐 Your materials first; the web is a labelled fallback (📕 book facts vs 🌐 web facts).")}
          </p>
        </section>

        <section className="wood leather-panel stack" style={{ borderRadius: 14 }}>
          <h2 className="emboss" style={{ fontSize: 26, color: "#fff4dc", textShadow: "0 -1px 0 #0008" }}>📚 {t("Books & notes")}</h2>
          <SourcesTray teacherId={id} onChange={reload} />
        </section>
      </div>

      <div className="row" style={{ justifyContent: "space-between", marginTop: 18 }}>
        <GelButton color="yellow" onClick={() => router.push(`/personality/${id}`)}>{t("← Back")}</GelButton>
        {teacher.draft
          ? <GelButton color="green" size="lg" onClick={next}>⚡ {t("Power On")} {fwd}</GelButton>
          : <div className="row"><GelButton color="blue" onClick={() => router.push(`/library/${id}`)}>🗄️ {t("Library")}</GelButton><GelButton color="green" size="lg" onClick={async () => { await flush(); router.push(`/classroom/${id}`); }}>🏫 {t("Go to class")}</GelButton></div>}
      </div>
    </main>
  );
}
