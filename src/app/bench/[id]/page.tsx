"use client";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client/api";
import { useI18n } from "@/lib/client/i18n";
import { BrassPlaque, GelButton, RubberStamp, TubeProgress } from "@/components/skeuo";
import { toast } from "@/components/Toasts";
import { Markdown } from "@/components/Markdown";
import { Chart, Versus } from "@/components/bench/Chart";
import { CATEGORY_LABEL, COND_COLOR, COND_HELP_LABEL, COND_LABEL, ERROR_KIND, STATUS_LABEL } from "@/components/bench/labels";
import { breakEven, summarize, type CellSummary, type Comparison } from "@/lib/bench/stats";
import type { BenchCall, BenchRun, Condition, QuestionCategory } from "@/lib/bench/types";

const METRIC_LABEL: Record<Comparison["metric"], string> = {
  total_ms: "Total answer time",
  ttft_ms: "Time to first word",
  input_tokens: "Input tokens",
  recall: "Key-fact recall",
  judge: "Judge score",
};

export default function BenchReport({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, tm, n, lang } = useI18n();
  const [run, setRun] = useState<BenchRun | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(() => api<{ run: BenchRun }>(`/api/bench/${id}`).then((d) => setRun(d.run)).catch(() => setMissing(true)), [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (run?.status !== "running") return;
    const timer = setInterval(() => void load(), 2500);
    return () => clearInterval(timer);
  }, [run?.status, load]);

  const summary = useMemo(() => (run ? summarize(run) : null), [run]);

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    try { const d = await api<{ run: BenchRun }>(`/api/bench/${id}`, { method: "POST", json: { action, ...extra } }); setRun(d.run); }
    catch (e) { toast(tm((e as Error).message), "error"); }
  };

  // Number formatting (Arabic digits in Arabic mode).
  const fx = (x: number, d = 1) => (Number.isFinite(x) ? n(Number(x.toFixed(d))) : "—");
  const pct = (x: number) => (Number.isFinite(x) ? `${n(Math.round(x * 100))}${lang === "ar" ? "٪" : "%"}` : "—");
  const sec = (ms: number) => (Number.isFinite(ms) ? t("{x} s", { x: fx(ms / 1000, 1) }) : "—");
  const tok = (x: number) => (Number.isFinite(x) ? n(Math.round(x)) : "—");
  const usd = (x: number) => (Number.isFinite(x) ? t("${x}", { x: fx(x, x < 1 ? 3 : 2) }) : "—");

  // Every call of a condition failed (e.g. the whole book is over a small model's limit): say why.
  const failNote = (c: CellSummary) => {
    if (!c.calls || c.errors < c.calls) return undefined;
    const top = Object.entries(c.error_kinds).sort((a, b) => b[1] - a[1])[0]?.[0] as keyof typeof ERROR_KIND | undefined;
    return t(ERROR_KIND[top ?? "other"]);
  };

  // Paired statistics table for one model, or "*" = all models pooled (same question, same model pairs).
  const statsTable = (model: string) => (
    <div className="paper form-sheet">
      <h3 className="panel-title">📐 {t("Statistics (paired by question)")}</h3>
      <div style={{ overflowX: "auto" }}>
        <table className="bench-table">
          <thead><tr>
            <th>{t("Measure")}</th><th>{t("Compared with")}</th><th>{t("Questions")}</th><th>{t("UEBAI")}</th><th>{t("Other")}</th>
            <th>{t("Difference (95% CI)")}</th><th>{t("× (median)")}</th><th>{t("UEBAI better / tie / worse")}</th><th>{t("p-value")}</th><th>{t("Not worse?")}</th>
          </tr></thead>
          <tbody>
            {(summary?.comparisons ?? []).filter((c) => c.model === model).map((c) => {
              const f = c.metric === "recall" ? pct : c.metric === "input_tokens" ? tok : c.metric === "judge" ? (x: number) => fx(x) : sec;
              const signed = (x: number) => (c.metric === "recall" ? `${x >= 0 ? "+" : "−"}${pct(Math.abs(x))}` : `${x >= 0 ? "+" : "−"}${f(Math.abs(x))}`);
              return (
                <tr key={`${c.b}-${c.metric}`}>
                  <td>{t(METRIC_LABEL[c.metric])}</td>
                  <td style={{ color: COND_COLOR[c.b] }}>{t(COND_LABEL[c.b])}</td>
                  <td>{n(c.n)}</td>
                  <td>{f(c.mean_a)}</td>
                  <td>{f(c.mean_b)}</td>
                  <td>{signed(c.mean_diff)} <span className="muted">({signed(c.diff_ci[0])} … {signed(c.diff_ci[1])})</span></td>
                  <td>{c.ratio_median ? `${fx(c.ratio_median, 1)}×` : "—"}</td>
                  <td>{n(c.wins)} / {n(c.ties)} / {n(c.losses)}</td>
                  <td>{!Number.isFinite(c.p) ? "—" : c.p < 0.0001 ? `< ${fx(0.0001, 4)}` : fx(c.p, 4)} {c.p < 0.05 && <b style={{ color: "#2e7d4f" }}>✓</b>}</td>
                  <td>{c.non_inferior === null ? "—" : c.non_inferior ? <b style={{ color: "#2e7d4f" }}>✓ {t("proven")}</b> : <span style={{ color: "#b8622a" }}>{t("not yet")}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>{t("Each question is compared with itself under both conditions. The p-value comes from a paired sign-flip permutation test; ✓ means p < 0.05. With few questions, p-values are large even for real differences — run more questions.")}</p>
      <p className="muted" style={{ fontSize: 13, margin: 0 }}>{t("“Not worse?” (quality only, 5+ questions): proven when the whole 95% interval of the difference stays above the margin fixed before the experiment — 10 points of key facts, or 1 point of judge score out of 10.")}</p>
    </div>
  );

  if (missing) return <main className="page"><p className="hand center">{t("This experiment does not exist.")} <Link href="/bench">{t("Back to the lab")}</Link></p></main>;
  if (!run || !summary) return <main className="page"><p className="hand center">{t("Reading the lab notebook…")}</p></main>;

  const cfg = run.config;
  const cell = (model: string, c: Condition) => summary.cells.find((x) => x.model === model && x.condition === c);
  const cmp = (model: string, b: Condition, m: Comparison["metric"]) => summary.comparisons.find((x) => x.model === model && x.b === b && x.metric === m);
  const errors = run.calls.filter((c) => c.status === "error");
  const pctDone = run.plan.length ? (run.calls.length / run.plan.length) * 100 : 0;
  const hasJudge = run.judgments.some((j) => !j.error);
  const hasHuman = run.ratings.length > 0;

  return (
    <main className="page bench-report">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <h1 className="page-title emboss">🔬 {t("Experiment report")}</h1>
        <RubberStamp color={run.status === "done" ? "#2e7d4f" : run.status === "failed" ? "#b3202a" : "#b8622a"}>{t(STATUS_LABEL[run.status])}</RubberStamp>
      </div>

      <section className="paper form-sheet" style={{ marginBottom: 18 }}>
        <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
          <div className="stack" style={{ gap: 4 }}>
            <b>{run.dataset.name}</b>
            <span className="muted">{t("Book: {b} — {p} pages, about {k} tokens, {c} topic cards", { b: run.book.labels.join("، "), p: n(run.book.pages), k: n(run.book.full_tokens_est), c: n(run.book.topics) })}</span>
            <span className="muted">{t("Model")}: <span dir="ltr">{cfg.models.join(", ")}</span> · {t("Repetitions")}: {n(cfg.reps)} · {t("Judge")}: <span dir="ltr">{cfg.judge_model ?? "—"}</span> · {t("Questions")}: {n(run.dataset.questions.length)}</span>
            <span className="muted" dir="ltr" style={{ fontSize: 13, textAlign: "start" }}>{run.id}</span>
            {run.dataset_sha256 && <span className="muted" style={{ fontSize: 13 }}>{t("Answer-key fingerprint (SHA-256): {h}", { h: run.dataset_sha256.slice(0, 16) + "…" })}</span>}
          </div>
          <div className="stack no-print" style={{ gap: 8, minWidth: 260 }}>
            <TubeProgress pct={pctDone} label={`${n(run.calls.length)} / ${n(run.plan.length)}`} />
            <span style={{ fontSize: 14 }}>{tm(run.message)}</span>
            <div className="row" style={{ gap: 6 }}>
              {run.status === "running" && <GelButton size="sm" color="yellow" onClick={() => act("pause")}>⏸ {t("Pause")}</GelButton>}
              {(run.status === "paused" || run.status === "failed") && <GelButton size="sm" color="green" onClick={() => act("resume")}>▶ {t("Resume")}</GelButton>}
              {run.status !== "running" && errors.some((e) => e.error_kind !== "too_large") && <GelButton size="sm" color="teal" onClick={() => act("retry")}>↻ {t("Retry failed")}</GelButton>}
              {run.status !== "running" && cfg.judge_model && <GelButton size="sm" color="purple" onClick={() => act("judge")}>⚖️ {t("Judge again")}</GelButton>}
              {run.status === "running" && <GelButton size="sm" color="red" onClick={() => act("cancel")}>■ {t("Stop")}</GelButton>}
            </div>
          </div>
        </div>
        <div className="row no-print" style={{ gap: 8 }}>
          <a className="metal-button" href={`/api/bench/${id}/export?format=csv`}>⬇ {t("Download CSV (Excel)")}</a>
          <a className="metal-button" href={`/api/bench/${id}/export?format=json`}>⬇ {t("Download JSON")}</a>
          <Link className="metal-button" href={`/bench/${id}/rate`}>🧑‍🏫 {t("Blind rating by teachers")}</Link>
          <button className="metal-button" onClick={() => window.print()}>🖨 {t("Print report")}</button>
          <Link className="metal-button" href="/bench">↩ {t("Back to the lab")}</Link>
        </div>
      </section>

      {cfg.models.length > 1 && summary.comparisons.some((c) => c.model === "*") && (
        <section className="stack" style={{ marginBottom: 26 }}>
          <h2 className="emboss" style={{ fontSize: 26 }}>🌐 {t("All models together")}</h2>
          <p className="paper" style={{ margin: 0, padding: "8px 14px", borderRadius: 3 }}>{t("Each question on each model is one pair (same question, same model): {n} pairs from {m} models.", { n: n(cmp("*", "full", "input_tokens")?.n ?? 0), m: n(cfg.models.length) })}</p>
          <div className="row" style={{ gap: 14, justifyContent: "center" }}>
            {(["total_ms", "ttft_ms", "input_tokens"] as const).map((m) => {
              const c = cmp("*", "full", m);
              if (!c?.ratio_median) return null;
              const label = m === "total_ms" ? "faster to a full answer" : m === "ttft_ms" ? "faster to the first word" : "fewer tokens read";
              return <BrassPlaque key={m} value={`${fx(c.ratio_median, m === "input_tokens" ? 0 : 1)}×`} label={t(label)} />;
            })}
          </div>
          {statsTable("*")}
        </section>
      )}

      {cfg.models.map((model) => {
        const full = cell(model, "full"), ue = cell(model, "uebai");
        const speed = cmp(model, "full", "total_ms"), first = cmp(model, "full", "ttft_ms"), tokens = cmp(model, "full", "input_tokens");
        const be = full && ue ? breakEven(summary.ingest.input_tokens, full.input_tokens.mean, ue.input_tokens.mean) : null;
        const conds = cfg.conditions;
        const rowsFor = (f: (c: CellSummary) => number, ci?: (c: CellSummary) => [number, number] | undefined) =>
          conds.map((c) => cell(model, c)!).map((c) => ({ key: c.condition, label: t(COND_LABEL[c.condition]), color: COND_COLOR[c.condition], value: f(c), ci: ci?.(c), note: failNote(c) }));
        return (
          <section key={model} className="stack" style={{ marginBottom: 26 }}>
            {cfg.models.length > 1 && <h2 className="emboss" style={{ fontSize: 26 }} dir="ltr">{model}</h2>}

            {full && ue && (
              <div className="row" style={{ gap: 14, justifyContent: "center" }}>
                {failNote(full)
                  ? <BrassPlaque value={`✗ ${failNote(full)}`} label={t("the whole book with this model")} />
                  : <>
                    <BrassPlaque value={speed?.ratio_median ? `${fx(speed.ratio_median, 1)}×` : "—"} label={t("faster to a full answer")} />
                    <BrassPlaque value={first?.ratio_median ? `${fx(first.ratio_median, 1)}×` : "—"} label={t("faster to the first word")} />
                    <BrassPlaque value={tokens?.ratio_median ? `${fx(tokens.ratio_median, 0)}×` : "—"} label={t("fewer tokens read")} />
                  </>}
                <BrassPlaque value={<Versus a={pct(ue.recall.mean)} b={pct(full.recall.mean)} />} label={t("key facts found")} />
                {hasJudge && <BrassPlaque value={<Versus a={fx(ue.judge.mean)} b={fx(full.judge.mean)} />} label={t("judge score /10")} />}
                <BrassPlaque value={<Versus a={usd(ue.cost_per_1000)} b={usd(full.cost_per_1000)} />} label={t("cost per 1,000 questions")} />
              </div>
            )}

            <div className="bench-grid">
              <Chart title={t("Total answer time")} hint={t("median, lower is better")} rows={rowsFor((c) => c.total_ms.median)} fmt={sec} />
              <Chart title={t("Time to first word")} hint={t("median, lower is better")} rows={rowsFor((c) => c.ttft_ms.median)} fmt={sec} />
              <Chart title={t("Input tokens per question")} hint={t("median, lower is cheaper")} rows={rowsFor((c) => c.input_tokens.median)} fmt={tok} />
              <Chart title={t("Key-fact recall")} hint={t("answerable questions, higher is better")} rows={rowsFor((c) => c.recall.mean, (c) => c.recall.ci)} fmt={pct} max={1} />
              {hasJudge && <Chart title={t("Judge score (0–10)")} hint={t("blind AI judge, higher is better")} rows={rowsFor((c) => c.judge.mean, (c) => c.judge.ci)} fmt={(x) => fx(x)} max={10} />}
              {hasHuman && <Chart title={t("Teacher score (1–5)")} hint={t("blind human rating, higher is better")} rows={rowsFor((c) => c.human.mean, (c) => c.human.ci)} fmt={(x) => fx(x)} max={5} />}
              {hasHuman && <Chart title={t("Picked as best by teachers")} hint={t("share of rated questions where teachers chose this answer")} rows={rowsFor((c) => c.human_best_share)} fmt={pct} max={1} />}
              <Chart title={t("Cites the right page")} hint={t("within one page of the answer key")} rows={rowsFor((c) => c.page_hit_rate)} fmt={pct} max={1} />
              <Chart title={t("Says “not in the book” when it isn't")} hint={t("unanswerable questions — no made-up answers")} rows={rowsFor((c) => c.abstention_rate)} fmt={pct} max={1} />
              {conds.some((c) => (cell(model, c)?.refused ?? 0) > 0) && (
                <Chart title={t("Refused by a busy server")} hint={t("share of requests the provider turned away (retried before timing)")} rows={rowsFor((c) => c.refused_rate)} fmt={pct} max={1} />
              )}
            </div>

            {statsTable(model)}

            <div className="paper form-sheet">
              <h3 className="panel-title">🗂️ {t("By kind of question")}</h3>
              <div style={{ overflowX: "auto" }}>
                <table className="bench-table">
                  <thead><tr><th>{t("Kind")}</th>{conds.map((c) => <th key={c} style={{ color: COND_COLOR[c] }}>{t(COND_LABEL[c])}</th>)}</tr></thead>
                  <tbody>
                    {(["fact", "explain", "multi", "unanswerable"] as QuestionCategory[]).filter((k) => run.dataset.questions.some((q) => q.category === k)).map((k) => (
                      <tr key={k}>
                        <td>{t(CATEGORY_LABEL[k])}</td>
                        {conds.map((c) => {
                          const x = cell(model, c)!;
                          if (k === "unanswerable") return <td key={c}>{t("says not in book: {x}", { x: pct(x.abstention_rate) })}{hasJudge && <> · {t("judge {x}", { x: fx(x.by_category.unanswerable?.judge.mean ?? NaN) })}</>}</td>;
                          const b = x.by_category[k];
                          return <td key={c}>{t("facts {x}", { x: pct(b?.recall.mean ?? NaN) })}{hasJudge && <> · {t("judge {x}", { x: fx(b?.judge.mean ?? NaN) })}</>}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {full && ue && (
              <div className="index-card" style={{ cursor: "default" }}>
                <b>💡 {t("One-time filing cost")}</b>
                <div>{t("Filing the book into topic cards happens once and reads the book about twice (≈ {k} input tokens). Each question then saves about {s} tokens compared with sending the whole book, so the filing pays for itself after about {q} questions.", { k: n(summary.ingest.input_tokens), s: n(Math.round(full.input_tokens.mean - ue.input_tokens.mean)), q: be ? n(be) : "—" })}</div>
              </div>
            )}
          </section>
        );
      })}

      <section className="two-col" style={{ alignItems: "start", marginBottom: 22 }}>
        <div className="paper form-sheet">
          <h3 className="panel-title">🧾 {t("Method")}</h3>
          <ul style={{ margin: 0, paddingInlineStart: 20, lineHeight: 1.7 }}>
            <li>{t("Same model, same settings and the same instructions for every condition; only the book material changes.")}</li>
            <li>{t("Calls go straight to the model — no fallback to other models; the model version that answered is recorded.")}</li>
            <li>{t("Waiting for rate limits happens before the timer starts. UEBAI's own routing time is included in its times.")}</li>
            <li>{t("Question and condition order is shuffled with a fixed seed ({s}).", { s: n(cfg.seed) })}</li>
            <li>{t("Key-fact recall is computed by code from the answer key; the judge model grades blind, with answers in random order.")}</li>
          </ul>
          {cfg.conditions.map((c) => <p key={c} style={{ margin: 0, fontSize: 14 }}><b style={{ color: COND_COLOR[c] }}>{t(COND_LABEL[c])}:</b> {t(COND_HELP_LABEL[c])}</p>)}
          {run.dataset.protocol && lang === "ar" && <p className="muted" style={{ fontSize: 13, margin: 0 }}>{run.dataset.protocol}</p>}
        </div>
        <div className="paper form-sheet">
          <h3 className="panel-title">⚠️ {t("Limitations (be honest with the judges)")}</h3>
          <ul style={{ margin: 0, paddingInlineStart: 20, lineHeight: 1.7 }}>
            <li>{t("The answer key was written from the book by the project team; have a subject teacher review it.")}</li>
            <li>{t("The AI judge can be wrong; blind ratings by real teachers are stronger evidence.")}</li>
            <li>{t("Free servers get busy: speed changes with the time of day. Repeat runs at different times.")}</li>
            <li>{t("The whole-book condition benefits from the provider's automatic caching of repeated text (see “cached” in the table below), which makes it faster and cheaper than a first-time read.")}</li>
            <li>{t("Speed and cost gains are large and certain; quality differences are smaller and need more questions to prove.")}</li>
          </ul>
        </div>
      </section>

      <section className="stack">
        <h2 className="emboss" style={{ fontSize: 24 }}>🔎 {t("Every question and answer")}</h2>
        {run.dataset.questions.map((q) => {
          const calls = run.calls.filter((c) => c.question_id === q.id);
          if (!calls.length) return null;
          return <QuestionBlock key={q.id} run={run} q={q} calls={calls} fmt={{ sec, tok, pct, fx }} />;
        })}
      </section>
    </main>
  );
}

function QuestionBlock({ run, q, calls, fmt }: {
  run: BenchRun; q: BenchRun["dataset"]["questions"][number]; calls: BenchCall[];
  fmt: { sec: (x: number) => string; tok: (x: number) => string; pct: (x: number) => string; fx: (x: number, d?: number) => string };
}) {
  const { t, n } = useI18n();
  const judge = new Map<string, { total: number; note: string }>();
  for (const j of run.judgments) for (const [id, s] of Object.entries(j.scores)) judge.set(id, s);
  const firstRep = calls.filter((c) => c.rep === 1).sort((a, b) => run.config.conditions.indexOf(a.condition) - run.config.conditions.indexOf(b.condition));
  return (
    <details className="paper form-sheet">
      <summary style={{ cursor: "pointer" }}>
        <b>{q.q}</b> <span className="muted">— {t(CATEGORY_LABEL[q.category])}{q.pages.length > 0 && ` · ${t("p.")} ${q.pages.map((p) => n(p)).join("، ")}`}</span>
      </summary>
      <p style={{ margin: "8px 0" }}><b>{t("Answer key")}:</b> {q.answer}</p>
      <div style={{ overflowX: "auto" }}>
        <table className="bench-table">
          <thead><tr>
            <th>{t("Condition")}</th>{run.config.models.length > 1 && <th>{t("Model")}</th>}<th>{t("Rep")}</th><th>{t("First word")}</th><th>{t("Total")}</th>
            <th>{t("Input tokens")}</th><th>{t("Cached")}</th><th>{t("Facts")}</th><th>{t("Pages cited")}</th><th>{t("Judge")}</th>
          </tr></thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.id}>
                <td style={{ color: COND_COLOR[c.condition] }}>{t(COND_LABEL[c.condition])}{c.parts ? <span className="muted"> ({t("read in {n} parts", { n: n(c.parts) })})</span> : null}</td>
                {run.config.models.length > 1 && <td dir="ltr">{c.model}</td>}
                <td>{n(c.rep)}</td>
                {c.status === "error"
                  ? <td colSpan={7} title={c.error}>❌ {t(ERROR_KIND[c.error_kind ?? "other"])}</td>
                  : <>
                    <td>{fmt.sec(c.ttft_ms ?? NaN)}</td>
                    <td>{fmt.sec(c.total_ms ?? NaN)}</td>
                    <td>{fmt.tok(c.input_tokens ?? NaN)}</td>
                    <td>{fmt.tok(c.cached_tokens ?? NaN)}</td>
                    <td>{q.category === "unanswerable" ? (c.correct_abstention ? t("✓ said not in book") : t("✗ answered anyway")) : fmt.pct(c.recall ?? NaN)}</td>
                    <td>{c.cited_pages.slice(0, 6).map((p) => n(p)).join("، ") || "—"}{c.page_hit === true ? " ✓" : c.page_hit === false ? " ✗" : ""}</td>
                    <td>{judge.has(c.id) ? fmt.fx(judge.get(c.id)!.total) : "—"}</td>
                  </>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bench-answers">
        {firstRep.filter((c) => c.status === "ok").map((c) => (
          <div key={c.id} className="index-card" style={{ cursor: "default" }}>
            <b style={{ color: COND_COLOR[c.condition] }}>{t(COND_LABEL[c.condition])}</b>
            {run.config.models.length > 1 && <span className="muted" dir="ltr"> {c.model}</span>}
            {c.topics?.length ? <div className="muted" style={{ fontSize: 13 }}>{t("Cards opened: {x}", { x: c.topics.join("، ") })}</div> : null}
            <div style={{ fontSize: 15, marginTop: 6 }}><Markdown>{c.answer}</Markdown></div>
            {judge.get(c.id)?.note && <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>⚖️ {judge.get(c.id)!.note}</div>}
          </div>
        ))}
      </div>
    </details>
  );
}
