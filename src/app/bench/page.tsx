"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { useI18n } from "@/lib/client/i18n";
import { GelButton, RubberStamp, TubeProgress } from "@/components/skeuo";
import { toast } from "@/components/Toasts";
import { CATEGORY_LABEL, COND_COLOR, COND_HELP_LABEL, COND_LABEL, STATUS_LABEL } from "@/components/bench/labels";
import { CONDITIONS, type BenchRun, type Condition, type QuestionCategory, type RunSummary } from "@/lib/bench/types";

interface Home {
  runs: RunSummary[];
  datasets: { file: string; name: string; book_hint: string | null; protocol: string | null; questions: { id: string; q: string; category: QuestionCategory; pages: number[] }[] }[];
  teachers: { id: string; name: string; subject: string; books: { filename: string; label: string; pages: number; tokens: number }[]; topics: number }[];
  has_key: boolean;
  keys: { gemini: boolean; deepseek: boolean };
}

const MODEL_SUGGESTIONS = ["gemini-3.6-flash", "deepseek-flash", "deepseek-v4-pro", "gemini-3.8-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "ollama:qwen3:4b"];

/** A small but balanced first run: a few of each kind, spread evenly over the book (not just its first pages). */
function pilotIds(qs: Home["datasets"][number]["questions"]) {
  const take: Record<QuestionCategory, number> = { fact: 3, explain: 2, multi: 1, unanswerable: 2 };
  return (Object.keys(take) as QuestionCategory[]).flatMap((cat) => {
    const inCat = qs.filter((q) => q.category === cat);
    const k = Math.min(take[cat], inCat.length);
    return Array.from({ length: k }, (_, i) => inCat[Math.floor(((i + 0.5) * inCat.length) / k)].id);
  });
}

export default function ProofLab() {
  const { t, tm, n, lang } = useI18n();
  const router = useRouter();
  const [home, setHome] = useState<Home | null>(null);
  const [teacherId, setTeacherId] = useState("");
  const [dataset, setDataset] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [model, setModel] = useState("gemini-3.6-flash");
  const [weakModel, setWeakModel] = useState("deepseek-flash");
  const [conds, setConds] = useState<Set<Condition>>(new Set(["full", "uebai", "rag"]));
  const [reps, setReps] = useState(1);
  const [judge, setJudge] = useState("gemini-3.8-flash");
  const [smallWindow, setSmallWindow] = useState(8192);
  const [thinking, setThinking] = useState<"low" | "high">("low");
  const [rpm, setRpm] = useState(5);
  const [tpm, setTpm] = useState(250_000);
  const [priceIn, setPriceIn] = useState(0.5);
  const [priceCached, setPriceCached] = useState(0.05);
  const [priceOut, setPriceOut] = useState(3);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Home>("/api/bench").then((h) => {
      setHome(h);
      // DeepSeek has no small daily cap, so it makes a steadier judge when its key is present.
      if (h.keys.deepseek) setJudge("deepseek-v4-pro");
      if (!h.keys.deepseek) setWeakModel("");
      const ds = h.datasets[0];
      if (ds) {
        setDataset(ds.file);
        setPicked(new Set(pilotIds(ds.questions)));
        const match = h.teachers.find((x) => !ds.book_hint || x.books.some((b) => b.filename.includes(ds.book_hint!)));
        setTeacherId((match ?? h.teachers[0])?.id ?? "");
      } else setTeacherId(h.teachers[0]?.id ?? "");
    }).catch((e) => toast(tm((e as Error).message), "error"));
  }, [tm]);

  const ds = home?.datasets.find((d) => d.file === dataset);
  const teacher = home?.teachers.find((x) => x.id === teacherId);
  const bookTokens = teacher?.books.reduce((s, b) => s + b.tokens, 0) ?? 0;
  const models = [model.trim(), weakModel.trim()].filter(Boolean);
  const calls = picked.size * conds.size * reps * models.length;
  const judgeCalls = judge.trim() ? picked.size * models.length : 0;
  // Rough: whole book per "full" call, ~4k tokens otherwise, the small window for "trunc".
  const estTokens = picked.size * reps * models.length * ((conds.has("full") ? bookTokens * 1.25 : 0) + (conds.has("uebai") ? 4000 : 0) + (conds.has("rag") ? 4000 : 0) + (conds.has("trunc") ? smallWindow : 0));
  const perModelCalls = picked.size * conds.size * reps;

  const byCategory = useMemo(() => {
    const m = new Map<QuestionCategory, Home["datasets"][number]["questions"]>();
    for (const q of ds?.questions ?? []) m.set(q.category, [...(m.get(q.category) ?? []), q]);
    return [...m];
  }, [ds]);

  const toggle = <T,>(set: Set<T>, v: T) => { const next = new Set(set); if (next.has(v)) next.delete(v); else next.add(v); return next; };

  const start = async () => {
    if (!picked.size) { toast(t("Pick at least one question"), "error"); return; }
    if (!conds.size) { toast(t("Pick at least one way of reading the book"), "error"); return; }
    setBusy(true);
    try {
      const { run } = await api<{ run: BenchRun }>("/api/bench", {
        method: "POST",
        json: {
          teacher_id: teacherId, dataset, question_ids: [...picked], models, conditions: CONDITIONS.filter((c) => conds.has(c)),
          reps, judge_model: judge.trim() || null, small_window: smallWindow, thinking, rpm, tpm, price_in: priceIn, price_cached: priceCached, price_out: priceOut,
        },
      });
      router.push(`/bench/${run.id}`);
    } catch (e) { toast(tm((e as Error).message), "error"); setBusy(false); }
  };

  if (!home) return <main className="page"><p className="hand center">{t("Warming up the lab…")}</p></main>;

  return (
    <main className="page">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <h1 className="page-title emboss">🔬 {t("Proof Lab")}</h1>
        <div className="row" style={{ gap: 12, alignItems: "center" }}>
          <Link className="metal-button" href="/bench/retrieval">🔎 {t("Free retrieval check")}</Link>
          <RubberStamp color="#2e7d4f">{t("Fair test")}</RubberStamp>
        </div>
      </div>

      <section className="notice-board cork" style={{ marginBottom: 24 }}>
        <div className="row" style={{ gap: 18, alignItems: "flex-start" }}>
          <div className="sticky-note" style={{ cursor: "default", maxWidth: 300 }}>
            <b>{t("What is tested?")}</b><br />{t("The same AI model answers the same questions about the same book — once reading the whole book, once reading only UEBAI's topic cards. We measure speed, tokens (cost) and answer quality.")}
          </div>
          <div className="sticky-note" style={{ cursor: "default", maxWidth: 300 }}>
            <b>{t("Why is it fair?")}</b><br />{t("Identical instructions for every condition. Questions come from randomly chosen pages and were written before any run. No hidden model fallbacks. A judge model grades answers without knowing which system wrote them, and teachers can grade them blind too.")}
          </div>
          <div className="sticky-note" style={{ cursor: "default", maxWidth: 300 }}>
            <b>{t("Free key limits")}</b><br />{t("Free Gemini keys allow only a few big requests per minute and a small number per day. The lab waits between calls, and if the daily quota runs out it pauses — press Resume tomorrow. Nothing already measured is lost.")}
          </div>
        </div>
      </section>

      <div className="two-col" style={{ alignItems: "start" }}>
        <section className="paper form-sheet">
          <h2 className="panel-title">🧪 {t("New experiment")}</h2>
          {!home.has_key && <p className="muted">{t("No API key found. Add GEMINI_API_KEY to .env.local to run experiments.")}</p>}
          {models.some((m) => m.startsWith("deepseek")) && !home.keys.deepseek && (
            <p style={{ color: "#b3202a", margin: 0 }}>{t("DeepSeek needs its own key: add DEEPSEEK_API_KEY to .env.local and restart the site.")}</p>
          )}
          {!home.teachers.length && <p className="muted">{t("No teacher has a filed book yet. Give a teacher a book first, then come back.")}</p>}

          <label className="field"><span>{t("Book (teacher)")}</span>
            <select className="typed-select" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
              {home.teachers.map((x) => <option key={x.id} value={x.id}>{x.name} — {x.books.map((b) => b.label).join("، ")}</option>)}
            </select>
          </label>
          {teacher && <p className="muted" style={{ margin: 0, fontSize: 14 }}>{t("{p} pages · about {k} tokens · {c} topic cards", { p: n(teacher.books.reduce((s, b) => s + b.pages, 0)), k: n(bookTokens), c: n(teacher.topics) })}</p>}

          <label className="field"><span>{t("Question set (answer key)")}</span>
            <select className="typed-select" value={dataset} onChange={(e) => { setDataset(e.target.value); const d = home.datasets.find((x) => x.file === e.target.value); setPicked(new Set(d ? pilotIds(d.questions) : [])); }}>
              {home.datasets.map((d) => <option key={d.file} value={d.file}>{d.name} ({n(d.questions.length)})</option>)}
            </select>
          </label>

          {ds && (
            <details open>
              <summary style={{ cursor: "pointer" }}>{t("Questions: {a} of {b} chosen", { a: n(picked.size), b: n(ds.questions.length) })}</summary>
              <div className="row" style={{ margin: "8px 0" }}>
                <GelButton size="xs" color="teal" onClick={() => setPicked(new Set(pilotIds(ds.questions)))}>{t("Quick pilot (8)")}</GelButton>
                <GelButton size="xs" color="blue" onClick={() => setPicked(new Set(ds.questions.map((q) => q.id)))}>{t("All")}</GelButton>
                <GelButton size="xs" color="yellow" onClick={() => setPicked(new Set())}>{t("None")}</GelButton>
              </div>
              <div className="stack" style={{ gap: 10, maxHeight: 340, overflow: "auto", paddingInlineEnd: 6 }}>
                {byCategory.map(([cat, qs]) => (
                  <div key={cat}>
                    <b>{t(CATEGORY_LABEL[cat])}</b>
                    {qs.map((q) => (
                      <label key={q.id} className="bench-check" style={{ fontSize: 15, margin: "4px 0" }}>
                        <input type="checkbox" checked={picked.has(q.id)} onChange={() => setPicked(toggle(picked, q.id))} />
                        <span>{q.q} {q.pages.length > 0 && <span className="muted">({t("p.")} {q.pages.map((p) => n(p)).join("، ")})</span>}</span>
                      </label>
                    ))}
                  </div>
                ))}
              </div>
              {ds.protocol && <p className="muted" style={{ fontSize: 13 }}>{lang === "ar" ? ds.protocol : t("How the questions were chosen is described in the question set file.")}</p>}
            </details>
          )}

          <div className="field"><span>{t("How the model gets the book")}</span>
            <div className="stack" style={{ gap: 6 }}>
              {CONDITIONS.map((c) => (
                <label key={c} className="bench-check">
                  <input type="checkbox" checked={conds.has(c)} onChange={() => setConds(toggle(conds, c))} />
                  <span><b style={{ color: COND_COLOR[c] }}>{t(COND_LABEL[c])}</b> — <span style={{ fontSize: 14 }}>{t(COND_HELP_LABEL[c])}</span></span>
                </label>
              ))}
            </div>
          </div>

          <div className="row">
            <label className="field grow"><span>{t("Model")}</span>
              <input className="typed-input" dir="ltr" list="bench-models" value={model} onChange={(e) => setModel(e.target.value)} />
            </label>
            <label className="field grow"><span>{t("Second model (optional)")}</span>
              <input className="typed-input" dir="ltr" list="bench-models" value={weakModel} placeholder="deepseek-flash" onChange={(e) => setWeakModel(e.target.value)} />
            </label>
            <datalist id="bench-models">{MODEL_SUGGESTIONS.map((m) => <option key={m} value={m} />)}</datalist>
          </div>
          <div className="row">
            <label className="field" style={{ width: 120 }}><span>{t("Repetitions")}</span>
              <input className="typed-input" type="number" min={1} max={10} value={reps} onChange={(e) => setReps(Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
            </label>
            <label className="field grow"><span>{t("Judge model (empty = no judge)")}</span>
              <input className="typed-input" dir="ltr" list="bench-models" value={judge} onChange={(e) => setJudge(e.target.value)} />
            </label>
          </div>

          <details>
            <summary style={{ cursor: "pointer" }}>{t("Advanced settings")}</summary>
            <div className="stack" style={{ gap: 10, marginTop: 8 }}>
              <div className="row">
                <label className="field grow"><span>{t("Small window (tokens)")}</span><input className="typed-input" type="number" min={1000} value={smallWindow} onChange={(e) => setSmallWindow(Number(e.target.value) || 8192)} /></label>
                <label className="field grow"><span>{t("Thinking")}</span>
                  <select className="typed-select" value={thinking} onChange={(e) => setThinking(e.target.value as "low" | "high")}><option value="low">{t("Low")}</option><option value="high">{t("High")}</option></select>
                </label>
              </div>
              <div className="row">
                <label className="field grow"><span>{t("Requests per minute")}</span><input className="typed-input" type="number" min={1} value={rpm} onChange={(e) => setRpm(Number(e.target.value) || 5)} /></label>
                <label className="field grow"><span>{t("Tokens per minute")}</span><input className="typed-input" type="number" min={1000} value={tpm} onChange={(e) => setTpm(Number(e.target.value) || 250_000)} /></label>
              </div>
              <div className="row">
                <label className="field grow"><span>{t("Price per 1M input tokens ($)")}</span><input className="typed-input" type="number" step="0.01" min={0} value={priceIn} onChange={(e) => setPriceIn(Number(e.target.value) || 0)} /></label>
                <label className="field grow"><span>{t("Price per 1M cached input tokens ($)")}</span><input className="typed-input" type="number" step="0.01" min={0} value={priceCached} onChange={(e) => setPriceCached(Number(e.target.value) || 0)} /></label>
                <label className="field grow"><span>{t("Price per 1M output tokens ($)")}</span><input className="typed-input" type="number" step="0.01" min={0} value={priceOut} onChange={(e) => setPriceOut(Number(e.target.value) || 0)} /></label>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t("Prices are assumptions for the cost estimate — check the provider's current price list.")}</p>
            </div>
          </details>

          <div className="index-card" style={{ cursor: "default" }}>
            <b>{t("This experiment")}</b>
            <div>{t("{c} answers + {j} judge calls · about {k} input tokens", { c: n(calls), j: n(judgeCalls), k: n(Math.round(estTokens)) })}</div>
            {conds.has("full") && perModelCalls > 18 && <div style={{ color: "#b3202a" }}>{t("Heads-up: free keys allow about 20 requests a day per model. The run will pause and continue tomorrow — or use a paid key.")}</div>}
          </div>
          <GelButton color="green" size="lg" onClick={start} disabled={busy || !teacherId || !dataset || !home.has_key}>{busy ? "…" : `▶ ${t("Start experiment")}`}</GelButton>
        </section>

        <section className="stack">
          <h2 className="emboss" style={{ fontSize: 24 }}>📋 {t("Past experiments")}</h2>
          {!home.runs.length && <p className="hand">{t("No experiments yet.")}</p>}
          {home.runs.map((r) => (
            <Link key={r.id} href={`/bench/${r.id}`} className="index-card" style={{ display: "block", color: "inherit", textDecoration: "none" }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <b dir="ltr">{r.id}</b>
                <span>{t(STATUS_LABEL[r.status])}</span>
              </div>
              <div style={{ fontSize: 14 }}>{r.dataset}</div>
              <div style={{ fontSize: 14 }} dir="ltr">{r.models.join(", ")}</div>
              <div style={{ fontSize: 14 }}>{r.conditions.map((c) => t(COND_LABEL[c])).join(" · ")}</div>
              <TubeProgress pct={r.total ? (r.done / r.total) * 100 : 0} label={`${n(r.done)} / ${n(r.total)}`} />
            </Link>
          ))}
        </section>
      </div>
    </main>
  );
}
