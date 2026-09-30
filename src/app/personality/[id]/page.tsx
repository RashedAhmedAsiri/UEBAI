"use client";
import { use, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTeacher } from "@/lib/client/useTeacher";
import { useI18n } from "@/lib/client/i18n";
import { api } from "@/lib/client/api";
import { play } from "@/lib/client/sound";
import { EDGE_VOICES, speak } from "@/lib/client/tts";
import { PRESETS, TITLES } from "@/lib/catalog";
import { HABITS, LEVELS, SLIDER_KEYS, type Personality, type SliderKey } from "@/lib/schemas";
import { sliderPhrase } from "@/lib/ai/personality";
import { Conveyor } from "@/components/Conveyor";
import { Fader, GelButton, MetalToggle, RubberStamp } from "@/components/skeuo";
import { toast } from "@/components/Toasts";

const HABIT_LABEL: Record<(typeof HABITS)[number], string> = {
  analogies: "Use analogies", examples: "Real-world examples", step_by_step: "Step-by-step solutions", check_question: "End with a check-question",
  mini_quiz: "Offer a mini-quiz", bullet_summary: "Summarize in bullets", emojis: "Use emojis",
};
const LEVEL_LABEL: Record<(typeof LEVELS)[number], string> = { elementary: "Elementary", middle: "Middle school", high_school: "High school", university: "University", adult: "Adult learner" };
const SLIDER_LABEL: Record<SliderKey, string> = {
  warmth: "Warmth", humor: "Humor", strictness: "Strictness", formality: "Formality", talkativeness: "Talkativeness",
  encouragement: "Encouragement", socratic: "Socratic-ness", creativity: "Creativity",
};

export default function PersonalityLab({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { t, tm, L, n, lang } = useI18n();
  const { teacher, patch, flush } = useTeacher(id);
  const [p, setP] = useState<Personality | null>(null);
  const [stamped, setStamped] = useState<string | null>(null);
  const [chat, setChat] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);

  useEffect(() => { if (teacher && !p) setP(teacher.personality); }, [teacher, p]);
  // Braces matter: newer browsers return a Promise from scrollIntoView, which must not leak out of the effect.
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [chat]);

  const update = (next: Personality) => { setP(next); void patch({ personality: next }); };

  const stamp = (key: string) => {
    if (!p) return;
    play("stamp");
    setStamped(key);
    update({ ...p, preset: key, sliders: PRESETS[key].sliders, habits: PRESETS[key].habits });
  };

  const preview = async (text?: string) => {
    if (!p) return;
    const message = (text ?? msg).trim() || t("Say hi!");
    setBusy(true);
    const history = [...chat, { role: "user" as const, content: message }];
    setChat(history);
    setMsg("");
    try {
      const d = await api<{ text: string }>(`/api/teachers/${id}/say`, { method: "POST", json: { kind: "preview", message, history: chat, personality: p } });
      setChat([...history, { role: "assistant", content: d.text }]);
      play("happy");
    } catch (e) { toast(tm((e as Error).message), "error"); }
    finally { setBusy(false); }
  };

  const next = async () => {
    await patch({ wizard_step: 4 }, true);
    await flush();
    play("clunk");
    toast(t("Personality chip inserted! 🧠"));
    router.push(`/subject/${id}`);
  };

  if (!teacher || !p) return <main className="page"><p className="hand center">{t("Opening the folder…")}</p></main>;
  const langs = p.language;
  const titles = TITLES[lang];

  return (
    <main className="page">
      {teacher.draft && <Conveyor id={id} current={3} reached={teacher.wizard_step} />}
      <h1 className="page-title emboss">{t("Personality Lab")}</h1>

      <div className="folder-page manila" data-tab={t("Personnel file · {name}", { name: p.name })}>
        <div className="row" style={{ gap: 4, marginBottom: 14 }}>
          <span className="field-label">{t("Preset stamps")}:</span>
          {Object.entries(PRESETS).map(([key, pr]) => (
            <button key={key} className={`stamp-button ${p.preset === key ? "selected" : ""}`} style={{ ["--sc" as string]: pr.stamp }} onClick={() => stamp(key)}>
              <span className="stamp-handle" />{L(pr.name)}
            </button>
          ))}
        </div>

        <div className="two-col">
          <section className="form-sheet lined-paper paper">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 className="typewriter" style={{ fontSize: 22 }}>{n(1)} · {t("Identity")}</h2>
              {stamped && <RubberStamp key={stamped} animate color={PRESETS[stamped].stamp}>{L(PRESETS[stamped].name)}</RubberStamp>}
            </div>
            <div className="row" style={{ alignItems: "flex-end" }}>
              <label className="field" style={{ width: 140 }}>
                <span>{t("Title")}</span>
                <select className="typed-select" value={titles.includes(p.title) ? p.title : "__custom"} onChange={(e) => update({ ...p, title: e.target.value === "__custom" ? "" : e.target.value })}>
                  {titles.map((x) => <option key={x}>{x}</option>)}<option value="__custom">{t("custom…")}</option>
                </select>
              </label>
              {!titles.includes(p.title) && (
                <label className="field" style={{ width: 120 }}><span>{t("Custom title")}</span><input className="typed-input" maxLength={20} value={p.title} onChange={(e) => update({ ...p, title: e.target.value })} /></label>
              )}
              <label className="field grow"><span>{t("Name")}</span><input className="typed-input" maxLength={40} value={p.name} onChange={(e) => update({ ...p, name: e.target.value || t("Bolt") })} /></label>
            </div>
            <div className="field">
              <span>{t("Catchphrases (up to 3)")}</span>
              {[0, 1, 2].map((i) => (
                <input key={i} className="typed-input" maxLength={120} placeholder={i === 0 ? t("Beep-boop, let's learn!") : ""} value={p.catchphrases[i] ?? ""}
                  onChange={(e) => { const c = [...p.catchphrases]; c[i] = e.target.value; update({ ...p, catchphrases: c.slice(0, 3).filter(Boolean) }); }} />
              ))}
            </div>
            <label className="field">
              <span>{t("Backstory")} ({n(p.backstory.length)}/{n(1000)})</span>
              <textarea className="typed-textarea" maxLength={1000} value={p.backstory} placeholder={t("Built in a greenhouse lab; fascinated by every living thing…")} onChange={(e) => update({ ...p, backstory: e.target.value })} />
            </label>
            <h2 className="typewriter" style={{ fontSize: 22 }}>{n(3)} · {t("Answer habits")}</h2>
            <div className="check-row">
              {HABITS.map((h) => (
                <label key={h} className="check">
                  <input type="checkbox" checked={p.habits.includes(h)} onChange={(e) => { play("tick"); update({ ...p, habits: e.target.checked ? [...p.habits, h] : p.habits.filter((x) => x !== h) }); }} />
                  {t(HABIT_LABEL[h])}
                </label>
              ))}
            </div>
            <h2 className="typewriter" style={{ fontSize: 22 }}>{n(4)} · {t("Language")} {t("and")} {t("Student level")}</h2>
            <div className="row">
              <label className="field" style={{ minWidth: 170 }}>
                <span>{t("Teacher's language")}</span>
                <select className="typed-select" value={langs.secondary ? "bi" : langs.primary} onChange={(e) => {
                  const v = e.target.value;
                  update({ ...p, language: v === "bi" ? { primary: "ar", secondary: "en", dialect: langs.dialect ?? "msa" } : { primary: v as "en" | "ar", secondary: null, dialect: v === "ar" ? langs.dialect ?? "msa" : null } });
                }}>
                  <option value="ar">{t("Arabic")}</option><option value="en">{t("English")}</option><option value="bi">{t("Bilingual (Arabic + English)")}</option>
                </select>
              </label>
              {(langs.primary === "ar" || langs.secondary === "ar") && (
                <label className="field" style={{ minWidth: 190 }}>
                  <span>{t("Arabic style")}</span>
                  <select className="typed-select" value={langs.dialect ?? "msa"} onChange={(e) => update({ ...p, language: { ...langs, dialect: e.target.value as "msa" | "saudi" } })}>
                    <option value="msa">{t("Modern Standard Arabic")}</option><option value="saudi">{t("Light Saudi dialect")}</option>
                  </select>
                </label>
              )}
              <label className="field" style={{ minWidth: 160 }}>
                <span>{t("Student level")}</span>
                <select className="typed-select" value={p.level} onChange={(e) => update({ ...p, level: e.target.value as Personality["level"] })}>
                  {LEVELS.map((l) => <option key={l} value={l}>{t(LEVEL_LABEL[l])}</option>)}
                </select>
              </label>
            </div>
          </section>

          <div className="stack">
            <section className="form-sheet grid-paper paper">
              <h2 className="typewriter" style={{ fontSize: 22 }}>{n(2)} · {t("Personality dials")}</h2>
              {SLIDER_KEYS.map((k) => (
                <div key={k}>
                  <Fader label={t(SLIDER_LABEL[k])} value={p.sliders[k]} format={(v) => n(v)} onChange={(v) => update({ ...p, preset: null, sliders: { ...p.sliders, [k]: v } })} />
                  <div className="hand muted" style={{ fontSize: 14, marginTop: -2 }}>✎ {t(sliderPhrase(k, p.sliders[k]))}</div>
                </div>
              ))}
            </section>

            <section className="form-sheet paper" style={{ gap: 10 }}>
              <h2 className="typewriter" style={{ fontSize: 22 }}>{n(5)} · {t("Voice")}</h2>
              <MetalToggle checked={p.voice.enabled} onChange={(v) => update({ ...p, voice: { ...p.voice, enabled: v } })} label={t("Speak answers aloud")} />
              {p.voice.enabled && (
                <>
                  <label className="field"><span>{t("Voice")}</span>
                    <select className="typed-select" value={p.voice.voiceId ?? ""} onChange={(e) => update({ ...p, voice: { ...p.voice, voiceId: e.target.value || null } })}>
                      <option value="">{t("Default voice")}</option>
                      {EDGE_VOICES
                        .filter((v) => v.lang === p.language.primary || v.lang === p.language.secondary)
                        .map((v) => <option key={v.id} value={v.id}>{v.name[lang]}</option>)}
                    </select>
                  </label>
                  <Fader label={t("Speed")} value={p.voice.rate} min={0.5} max={2} step={0.1} format={(v) => n(Number(v.toFixed(1)))} onChange={(v) => update({ ...p, voice: { ...p.voice, rate: v } })} />
                  <GelButton size="sm" color="blue" onClick={() => {
                    speak(t("Hello! I am {title} {name}.", { title: p.title, name: p.name }), { lang: p.language.primary, voiceId: p.voice.voiceId, rate: p.voice.rate });
                  }}>🔊 {t("Test voice")}</GelButton>
                </>
              )}
            </section>

            <section className="clipboard">
              <div className="paper-sheet lined-paper">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <b className="typewriter">{t("Preview — test chat")}</b>
                  <GelButton size="xs" color="green" onClick={() => preview(t("Say hi!"))} disabled={busy}>👋 {t("Say hi")}</GelButton>
                </div>
                <div className="stack" style={{ maxHeight: 260, overflowY: "auto", marginTop: 8, fontFamily: "var(--font-hand)", fontSize: 17, lineHeight: "26px" }}>
                  {chat.map((m, i) => <div key={i} style={{ color: m.role === "user" ? "#1e2a4a" : "#8e2c2c" }}><b>{m.role === "user" ? t("You") : p.name}:</b> {m.content}</div>)}
                  {busy && <div className="muted">{t("{name} is thinking", { name: p.name })} <span className="spin">⚙️</span></div>}
                  <div ref={chatEnd} />
                </div>
                <form className="row" style={{ marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); void preview(); }}>
                  <input className="typed-input grow" value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t("Ask something…")} />
                  <GelButton size="xs" color="blue" type="submit" disabled={busy}>{t("Send")}</GelButton>
                </form>
              </div>
            </section>
          </div>
        </div>

        <div className="row" style={{ justifyContent: "space-between", marginTop: 18 }}>
          <GelButton color="yellow" onClick={() => router.push(`/workshop/${id}?tab=dress`)}>{t("← Back")}</GelButton>
          {teacher.draft
            ? <GelButton color="green" size="lg" sound="clunk" onClick={next}>🔌 {t("Insert chip")} · {t("Next →")}</GelButton>
            : <GelButton color="green" size="lg" onClick={async () => { await flush(); toast(t("Reprogrammed! 🧠")); router.push(`/classroom/${id}`); }}>💾 {t("Save and go to class")}</GelButton>}
        </div>
      </div>
    </main>
  );
}
