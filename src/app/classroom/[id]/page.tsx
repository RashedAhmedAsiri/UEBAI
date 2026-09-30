"use client";
import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTeacher } from "@/lib/client/useTeacher";
import { useI18n } from "@/lib/client/i18n";
import { api, readSse } from "@/lib/client/api";
import { play } from "@/lib/client/sound";
import { speak as speakAloud, stopSpeaking } from "@/lib/client/tts";
import { stripInternalIds } from "@/lib/text";
import type { Citation, Conversation, Message, RobotState } from "@/lib/types";
import { quizPrompt } from "@/lib/ai/prompts";
import { RobotStage } from "@/components/robot/RobotStage";
import type { Reaction } from "@/components/robot/Robot";
import { BrassPlaque, FolderModal, GelButton, MetalButton, VuGauge } from "@/components/skeuo";
import { Markdown } from "@/components/Markdown";
import { ClassWindow, DustMotes, WallClock } from "@/components/ClassroomDecor";
import { toast } from "@/components/Toasts";

interface Meter { tokens_in: number; tokens_out: number; baseline: number; tiers: number[]; saved_total: number }
type UiMessage = Message & { streaming?: boolean; tools?: string[] };

const SLEEP_AFTER_MS = 120_000;
const isShort = (s: string) => s.length < 260 && !/```|\n\||\$\$|\n- .*\n- /.test(s);
export default function Classroom({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { t, tm, n, lang } = useI18n();
  const { teacher } = useTeacher(id);
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [activeTopics, setActiveTopics] = useState<{ id: string; title: string }[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<RobotState>("idle");
  const [reaction, setReaction] = useState<Reaction | null>(null);
  const [meter, setMeter] = useState<Meter | null>(null);
  const [savedTotal, setSavedTotal] = useState(0);
  const [openCitation, setOpenCitation] = useState<Citation | null>(null);
  const [settings, setSettings] = useState(false);
  const [listening, setListening] = useState(false);
  const [muted, setMuted] = useState(false);
  const talk = useRef(0);
  const lastActivity = useRef(Date.now());
  const scroller = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);

  const bump = () => { lastActivity.current = Date.now(); setState((s) => (s === "sleeping" ? "idle" : s)); };

  const openConv = useCallback(async (cid: string) => {
    const d = await api<{ conversation: Conversation; messages: Message[]; active_topics: { id: string; title: string }[] }>(`/api/conversations/${cid}`);
    setConv(d.conversation);
    setMessages(d.messages);
    setActiveTopics(d.active_topics);
    const last = [...d.messages].reverse().find((m) => m.role === "assistant");
    setMeter(last ? { tokens_in: last.tokens_in, tokens_out: last.tokens_out, baseline: last.baseline_tokens, tiers: last.tiers_used, saved_total: 0 } : null);
  }, []);

  const newLesson = useCallback(async () => {
    const d = await api<{ conversation: Conversation }>(`/api/teachers/${id}/conversations`, { method: "POST" });
    setConvs((c) => [d.conversation, ...c]);
    setConv(d.conversation);
    setMessages([]);
    setActiveTopics([]);
    setMeter(null);
    play("paper");
  }, [id]);

  // Load lessons.
  useEffect(() => {
    (async () => {
      const d = await api<{ conversations: Conversation[] }>(`/api/teachers/${id}/conversations`);
      setConvs(d.conversations);
      if (d.conversations[0]) await openConv(d.conversations[0].id);
      else await newLesson();
    })().catch((e) => toast(tm((e as Error).message), "error"));
  }, [id, openConv, newLesson, tm]);

  useEffect(() => { if (teacher) setSavedTotal(teacher.tokens_saved); }, [teacher]);

  // Fall asleep after 2 minutes idle; wake + wave on return.
  useEffect(() => {
    const iv = setInterval(() => { if (!busy && Date.now() - lastActivity.current > SLEEP_AFTER_MS) setState((s) => (s === "idle" ? "sleeping" : s)); }, 5000);
    const wake = () => { if (Date.now() - lastActivity.current > SLEEP_AFTER_MS) setReaction({ kind: "wave", n: Date.now() }); bump(); };
    const vis = () => { if (document.visibilityState === "visible") { setReaction({ kind: "wave", n: Date.now() }); bump(); } };
    window.addEventListener("pointermove", wake);
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(iv); window.removeEventListener("pointermove", wake); document.removeEventListener("visibilitychange", vis); };
  }, [busy]);

  // Talk level decays between tokens.
  useEffect(() => { const iv = setInterval(() => { talk.current = Math.max(0.15, talk.current * 0.85); }, 60); return () => clearInterval(iv); }, []);

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  // Mute is a per-browser preference; storage can be unavailable (private mode), so it's best-effort.
  useEffect(() => { try { setMuted(localStorage.getItem("roboprof.muted") === "1"); } catch { /* ignore */ } }, []);
  useEffect(() => stopSpeaking, []);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    try { localStorage.setItem("roboprof.muted", next ? "1" : "0"); } catch { /* ignore */ }
    if (next) { stopSpeaking(); setState((s) => (s === "talking" ? "idle" : s)); }
  };

  const speak = useCallback((text: string) => {
    const v = teacher?.personality.voice;
    if (!v?.enabled || muted) return false;
    return speakAloud(text, {
      lang: teacher!.personality.language.primary, voiceId: v.voiceId, rate: v.rate,
      onBoundary: () => { talk.current = 1; },
      onStart: () => setState("talking"),
      onEnd: () => setState("idle"),
    });
  }, [teacher, muted]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || !conv || busy) return;
    stopSpeaking();
    bump();
    setBusy(true);
    setInput("");
    play("paper");
    const userMsg: UiMessage = { id: `u${Date.now()}`, conversation_id: conv.id, role: "user", content: q, citations: [], topic_ids: [], tiers_used: [], tokens_in: 0, tokens_out: 0, baseline_tokens: 0, created_at: new Date().toISOString() };
    const draftId = `a${Date.now()}`;
    const draft: UiMessage = { ...userMsg, id: draftId, role: "assistant", content: "", streaming: true, tools: [] };
    setMessages((m) => [...m, userMsg, draft]);
    setState("thinking");
    play("thinking");
    const upd = (f: (m: UiMessage) => UiMessage) => setMessages((ms) => ms.map((m) => (m.id === draftId ? f(m) : m)));
    let started = false, finalText = "";
    try {
      abort.current = new AbortController();
      const res = await fetch(`/api/conversations/${conv.id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: q }), signal: abort.current.signal });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Request failed");
      for await (const { event, data } of readSse(res)) {
        const ev = data as Record<string, unknown>;
        switch (event) {
          case "route": setActiveTopics(ev.topics as { id: string; title: string }[]); break;
          case "robot_state": if (ev.state !== "idle" || !teacher?.personality.voice.enabled) setState(ev.state as RobotState); break;
          case "tool": upd((m) => ({ ...m, tools: [...(m.tools ?? []), String(ev.detail)] })); play("thinking"); break;
          case "token":
            if (!started) { started = true; play("chalk"); setState("talking"); }
            finalText += String(ev.text);
            talk.current = 1;
            upd((m) => ({ ...m, content: m.content + String(ev.text) }));
            break;
          case "citation": upd((m) => ({ ...m, citations: [...m.citations, ev.citation as Citation] })); break;
          case "meter": setMeter(ev as unknown as Meter); setSavedTotal(Number(ev.saved_total) || 0); break;
          case "done": {
            const msg = ev.message as Message;
            upd((m) => ({ ...msg, tools: m.tools, streaming: false }));
            setConvs((cs) => cs.map((c) => (c.id === conv.id && c.title === "New lesson" ? { ...c, title: q.split(/\s+/).slice(0, 7).join(" ") } : c)));
            break;
          }
          case "error": toast(tm(String(ev.message)), "error"); setState("confused"); break;
        }
      }
      if (/perfect|100%|all correct|full marks|ممتاز|أحسنت|إجابات صحيحة كلها/i.test(finalText.slice(0, 300))) { setReaction({ kind: "dance", n: Date.now() }); play("happy"); }
      if (!speak(finalText)) setTimeout(() => setState((s) => (s === "talking" || s === "thinking" ? "idle" : s)), 900);
    } catch (e) {
      if ((e as Error).name !== "AbortError") { toast(tm((e as Error).message), "error"); setState("confused"); }
      upd((m) => ({ ...m, streaming: false, content: m.content || t("_(My circuits fizzled — please try again.)_") }));
    } finally {
      setBusy(false);
      bump();
    }
  };

  const mic = () => {
    type SR = { lang: string; interimResults: boolean; onresult: (e: { results: { 0: { transcript: string } }[] }) => void; onend: () => void; start: () => void };
    const W = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) { toast(t("Speech input isn't supported in this browser."), "error"); return; }
    const r = new Ctor();
    r.lang = lang === "ar" ? "ar-SA" : "en-US";
    r.interimResults = false;
    r.onresult = (e) => setInput((cur) => (cur ? cur + " " : "") + e.results[0][0].transcript);
    r.onend = () => setListening(false);
    setListening(true);
    setState("listening");
    r.start();
  };

  if (!teacher) return <main className="page"><p className="hand center">{t("Opening the classroom…")}</p></main>;
  const topicTitle = activeTopics[0]?.title ?? (teacher.subject.name || t("this topic"));
  const quick: [string, string][] = [
    [t("Explain simpler"), t("Explain that again, simpler.")],
    [t("Give an example"), t("Give me another example.")],
    [t("Quiz me"), quizPrompt("quiz", topicTitle, lang)],
    [t("Make flashcards"), quizPrompt("flashcards", topicTitle, lang)],
    [t("Summarize this topic"), t("Summarize the topic “{topic}” in bullets.", { topic: topicTitle })],
  ];
  const citeLabel = (c: Citation) => c.kind === "web" ? c.label : t("{source} · p.{page}", { source: c.source_label ?? "", page: n(c.page ?? 0) }) + (c.topic_title ? ` · ${c.topic_title}` : "");
  const used = meter ? meter.tokens_in + meter.tokens_out : 0;

  return (
    <main className="page">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <h1 className="page-title emboss" style={{ margin: 0 }}>🏫 {teacher.title} {teacher.name} · {teacher.subject.name || t("Classroom")}</h1>
        <div className="row">
          <select className="metal-button" value={conv?.id ?? ""} onChange={(e) => openConv(e.target.value)} aria-label={t("Lessons")}>
            {convs.map((c) => <option key={c.id} value={c.id}>{c.title === "New lesson" ? t("New lesson") : c.title}</option>)}
          </select>
          <MetalButton onClick={newLesson}>📝 {t("New lesson")}</MetalButton>
          {teacher.personality.voice.enabled && (
            <MetalButton onClick={toggleMute} aria-pressed={muted} aria-label={muted ? t("Unmute") : t("Mute")}>{muted ? `🔇 ${t("Unmute")}` : `🔊 ${t("Mute")}`}</MetalButton>
          )}
          <MetalButton onClick={() => setSettings(true)} aria-label={t("Settings")}>⚙️ {t("Settings")}</MetalButton>
        </div>
      </div>

      <div className="classroom">
        <section className="class-wall">
          <DustMotes />
          <div className="row" style={{ justifyContent: "space-between", position: "relative", zIndex: 1 }}>
            <WallClock />
            <div className="topic-strip">
              <span className="hand">{t("Reading")}:</span>
              {activeTopics.length ? activeTopics.map((tp) => <Link key={tp.id} className="topic-book" href={`/library/${id}?topic=${tp.id}`}>📘 {tp.title}</Link>) : <span className="hand muted">—</span>}
            </div>
            <ClassWindow />
          </div>

          <div className="chat-scroll" ref={scroller} aria-live="polite">
            {messages.length === 0 && (
              <div className="chalkboard chalk-text" style={{ fontSize: 26, textAlign: "center" }}>
                <div className="chalk-reveal">{t("Welcome to class! Ask {teacher} anything about {subject}.", { teacher: `${teacher.title} ${teacher.name}`, subject: teacher.subject.name || t("anything") })}</div>
              </div>
            )}
            {messages.map((m) => m.role === "user" ? (
              <div key={m.id} className="msg-student lined-paper">{m.content}</div>
            ) : (
              <div key={m.id} className={isShort(m.content) && !m.streaming ? "msg-teacher-board" : "msg-teacher-clip"}>
                {(m.tools ?? []).map((tl, i) => <div key={i} className="tool-note">🔎 {tm(tl)}</div>)}
                {m.content === "" && m.streaming ? (
                  <div className="tool-note" style={{ fontSize: 20 }}><span className="spin">⚙️</span> {t("{name} is thinking…", { name: teacher.name })}</div>
                ) : isShort(m.content) && !m.streaming ? (
                  <><div className="chalkboard chalk-text"><div className="chalk-reveal"><Markdown>{stripInternalIds(m.content)}</Markdown></div></div><div className="chalk-tray" /></>
                ) : (
                  <div className="clipboard"><div className="paper-sheet lined-paper"><Markdown>{stripInternalIds(m.content) + (m.streaming ? " ▍" : "")}</Markdown></div></div>
                )}
                {m.citations.length > 0 && (
                  <div className="citations">
                    {m.citations.map((c, i) => c.kind === "web"
                      ? <a key={i} className="sticky-note" href={c.url} target="_blank" rel="noreferrer noopener">{c.label}</a>
                      : <button key={i} className="sticky-note" onClick={() => { play("paper"); setOpenCitation(c); }}>📕 {citeLabel(c)}</button>)}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="desk-input wood">
            <div className="quick-buttons">
              {quick.map(([label, prompt], i) => (
                <GelButton key={label} size="xs" color={(["blue", "green", "purple", "orange", "teal"] as const)[i]} disabled={busy || !conv} onClick={() => send(prompt)}>{label}</GelButton>
              ))}
            </div>
            <form onSubmit={(e) => { e.preventDefault(); void send(input); }}>
              <span className="pencil" aria-hidden>✏️</span>
              <textarea
                className="lined-paper" value={input} placeholder={t("Ask your teacher anything…")} rows={2}
                onChange={(e) => { setInput(e.target.value); bump(); if (!busy) setState(e.target.value ? "listening" : "idle"); }}
                onBlur={() => { if (!busy && state === "listening") setState("idle"); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
              />
              <GelButton type="button" color={listening ? "red" : "yellow"} size="sm" onClick={mic} aria-label={t("Speak")}>🎤</GelButton>
              {busy
                ? <GelButton type="button" color="red" onClick={() => abort.current?.abort()} aria-label={t("Stop")}>■</GelButton>
                : <GelButton type="submit" color="green" disabled={!input.trim()}>{t("Send")}</GelButton>}
            </form>
          </div>
        </section>

        <aside className="stack">
          <div className="workbench wood" style={{ minHeight: 0 }}>
            <div className="stage" style={{ height: "min(62vh, 560px)", background: "radial-gradient(ellipse at 50% 30%, #f3f5f4, #cfd4d2 70%, #9fa6a3)" }}>
              <RobotStage config={teacher.robot_config} mode="classroom" state={state} reaction={reaction} talkLevel={talk} fallbackImage={teacher.avatar_url} pointAtBoard />
            </div>
          </div>
        </aside>
      </div>

      {settings && (
        <FolderModal tab={t("Settings")} onClose={() => setSettings(false)}>
          <div className="stack">
            <h2 className="typewriter">⚙️ {t("Classroom settings")}</h2>
            <div className="two-col">
              <div className="brushed-metal rivets" style={{ borderRadius: 12, padding: 12 }}>
                <div className="panel-title emboss center">⛽ {t("Brain Fuel")}</div>
                <VuGauge used={used} baseline={meter?.baseline ?? 0} />
                <div className="gauge-caption">
                  {meter
                    ? meter.baseline > 0
                      ? t("Last answer: {used} tokens vs whole library {baseline} ({pct}) · tiers {tiers}", {
                          used: n(used), baseline: n(meter.baseline), pct: `${n(Number(((100 * used) / meter.baseline).toFixed(1)))}٪`,
                          tiers: meter.tiers.map((x) => n(x)).join("+") || "—",
                        })
                      : t("Last answer: {used} tokens", { used: n(used) })
                    : t("Ask a question to fuel up")}
                </div>
                <div className="center" style={{ marginTop: 10 }}><BrassPlaque value={n(savedTotal)} label={t("Tokens saved")} /></div>
              </div>
              <div className="stack">
                <p className="hand" style={{ margin: 0 }}>{t("The gauge shows how little of your books the teacher had to read for the last answer, thanks to the topic library.")}</p>
                <GelButton color="purple" onClick={() => router.push(`/workshop/${id}?tab=dress`)}>👔 {t("Dress up")}</GelButton>
                <GelButton color="blue" onClick={() => router.push(`/library/${id}`)}>🗄️ {t("Library")}</GelButton>
                <GelButton color="orange" onClick={() => router.push(`/subject/${id}`)}>📚 {t("Subject Desk")}</GelButton>
                <GelButton color="teal" onClick={() => router.push(`/personality/${id}`)}>🧠 {t("Reprogram")}</GelButton>
                <GelButton color="red" onClick={async () => {
                  if (!window.confirm(t("Delete {name} and all their files? This cannot be undone.", { name: `${teacher.title} ${teacher.name}` }))) return;
                  await api(`/api/teachers/${id}`, { method: "DELETE" }); router.push("/");
                }}>🗑 {t("Delete teacher")}</GelButton>
              </div>
            </div>
          </div>
        </FolderModal>
      )}

      {openCitation && (
        <FolderModal tab={citeLabel(openCitation)} onClose={() => setOpenCitation(null)}>
          <h2 className="typewriter" style={{ marginBottom: 10 }}>📕 {citeLabel(openCitation)}</h2>
          <div className="lined-paper" style={{ padding: "12px 50px 12px 16px", whiteSpace: "pre-wrap", fontSize: 16, lineHeight: "26px" }}>{openCitation.passage ?? t("No passage text stored.")}</div>
          {openCitation.topic_id && <p style={{ marginTop: 12 }}><Link className="metal-button" href={`/library/${id}?topic=${openCitation.topic_id}`}>🗄️ {t("Open “{topic}” in the Library", { topic: openCitation.topic_title ?? "" })}</Link></p>}
        </FolderModal>
      )}
    </main>
  );
}
