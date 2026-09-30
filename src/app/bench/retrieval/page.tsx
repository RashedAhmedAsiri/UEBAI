"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client/api";
import { useI18n } from "@/lib/client/i18n";
import { BrassPlaque, GelButton } from "@/components/skeuo";
import { toast } from "@/components/Toasts";
import { Chart } from "@/components/bench/Chart";
import { CATEGORY_LABEL, COND_COLOR, COND_LABEL } from "@/components/bench/labels";
import { summarizeRetrieval } from "@/lib/bench/stats";
import type { Condition, RetrievalReport } from "@/lib/bench/types";

type Saved = RetrievalReport & { file: string };
interface Home { teachers: { id: string; name: string; books: { filename: string }[] }[]; datasets: { file: string; name: string; book_hint: string | null }[] }

/**
 * Free retrieval check: no answers are generated, so it uses no AI quota and covers every
 * question. It shows whether the material each method gives the model contains the answer.
 */
export default function RetrievalCheck() {
  const { t, tm, n, lang } = useI18n();
  const [home, setHome] = useState<Home | null>(null);
  const [reports, setReports] = useState<Saved[] | null>(null);
  const [shown, setShown] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [dataset, setDataset] = useState("");
  const [exact, setExact] = useState(true);
  const [allSources, setAllSources] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Home>("/api/bench").then((h) => {
      setHome(h);
      const ds = h.datasets[0];
      if (ds) {
        setDataset(ds.file);
        setTeacherId((h.teachers.find((x) => !ds.book_hint || x.books.some((b) => b.filename.includes(ds.book_hint!))) ?? h.teachers[0])?.id ?? "");
      }
    }).catch((e) => toast(tm((e as Error).message), "error"));
    api<{ reports: Saved[] }>("/api/bench/retrieval").then((d) => { setReports(d.reports); setShown(d.reports[0]?.file ?? ""); }).catch(() => setReports([]));
  }, [tm]);

  const run = async () => {
    setBusy(true);
    try {
      const { report } = await api<{ report: Saved }>("/api/bench/retrieval", { method: "POST", json: { teacher_id: teacherId, dataset, exact, all_sources: allSources } });
      setReports((r) => [report, ...(r ?? []).filter((x) => x.file !== report.file)]);
      setShown(report.file);
    } catch (e) { toast(tm((e as Error).message), "error"); }
    setBusy(false);
  };

  const pct = (x: number) => (Number.isFinite(x) ? `${n(Math.round(x * 100))}${lang === "ar" ? "٪" : "%"}` : "—");
  const tok = (x: number) => (Number.isFinite(x) ? n(Math.round(x)) : "—");
  const report = reports?.find((r) => r.file === shown);
  const sum = report ? summarizeRetrieval(report) : [];
  const row = (c: Condition) => sum.find((s) => s.condition === c);
  const ue = row("uebai"), full = row("full");
  const ueTokens = ue && Number.isFinite(ue.tokens_exact) ? ue.tokens_exact : ue?.tokens_est ?? NaN;
  const fullTokens = report?.book.full_tokens_exact ?? report?.book.full_tokens_est ?? NaN;
  const bars = (f: (s: (typeof sum)[number]) => number) => sum.map((s) => ({ key: s.condition, label: t(COND_LABEL[s.condition]), color: COND_COLOR[s.condition], value: f(s) }));

  return (
    <main className="page">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <h1 className="page-title emboss">🔎 {t("Free retrieval check")}</h1>
        <Link className="metal-button" href="/bench">↩ {t("Back to the lab")}</Link>
      </div>

      <section className="notice-board cork" style={{ marginBottom: 20 }}>
        <div className="row" style={{ gap: 18, alignItems: "flex-start" }}>
          <div className="sticky-note" style={{ cursor: "default", maxWidth: 340 }}>
            <b>{t("What does it check?")}</b><br />{t("For every question, does the material each method gives the model actually contain the answer — the answer key's facts and its page? No answers are written, so it costs no AI quota and covers every question.")}
          </div>
          <div className="sticky-note" style={{ cursor: "default", maxWidth: 340 }}>
            <b>{t("Why is it fair?")}</b><br />{t("A fact only counts if it can be found somewhere in the whole book's text (PDF text is sometimes garbled), so every method is measured against exactly the same facts. The whole book scores 100% by definition.")}
          </div>
        </div>
      </section>

      <section className="paper form-sheet no-print" style={{ marginBottom: 20 }}>
        <div className="row">
          <label className="field grow"><span>{t("Book (teacher)")}</span>
            <select className="typed-select" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
              {home?.teachers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          <label className="field grow"><span>{t("Question set (answer key)")}</span>
            <select className="typed-select" value={dataset} onChange={(e) => setDataset(e.target.value)}>
              {home?.datasets.map((d) => <option key={d.file} value={d.file}>{d.name}</option>)}
            </select>
          </label>
        </div>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={exact} onChange={(e) => setExact(e.target.checked)} /> {t("Also count tokens exactly with Google's free token counter")}</label>
        <label className="row" style={{ gap: 8 }}><input type="checkbox" checked={allSources} onChange={(e) => setAllSources(e.target.checked)} /> {t("Use all of the teacher's sources (e.g. textbook + slides), not only the question set's book")}</label>
        <GelButton color="green" onClick={run} disabled={busy || !teacherId || !dataset}>{busy ? "…" : `▶ ${t("Run the free check")}`}</GelButton>
      </section>

      {reports && reports.length > 1 && (
        <div className="tabs no-print">
          {reports.map((r) => <button key={r.file} className="metal-button" aria-pressed={r.file === shown} onClick={() => setShown(r.file)}>{r.dataset}{r.scope === "all_sources" ? ` — ${t("sources: {n}", { n: n(r.book.labels.length) })}` : ""}</button>)}
        </div>
      )}
      {reports?.length === 0 && <p className="hand">{t("No check has been run yet.")}</p>}

      {report && ue && full && (
        <section className="stack">
          <p className="muted" style={{ margin: 0 }}>
            {t("Book: {b} — {p} pages, {k} tokens, {c} topic cards", { b: report.book.labels.join("، "), p: n(report.book.pages), k: tok(fullTokens), c: n(report.book.topics) })}
            {report.counted_with ? ` · ${t("exact counts from Google's token counter")}` : ""}
          </p>
          <div className="row" style={{ gap: 14, justifyContent: "center" }}>
            <BrassPlaque value={pct(ue.coverage)} label={t("of the answer facts are in UEBAI's material")} />
            <BrassPlaque value={pct(ue.page)} label={t("of answer pages are in UEBAI's material")} />
            <BrassPlaque value={`${n(Number(((ueTokens / fullTokens) * 100).toFixed(1)))}${lang === "ar" ? "٪" : "%"}`} label={t("of the book is read (median)")} />
            <BrassPlaque value={`${n(Math.round(fullTokens / ueTokens))}×`} label={t("fewer tokens than the whole book")} />
          </div>
          <div className="bench-grid">
            <Chart title={t("Answer facts in the material")} hint={t("average share of the answer key's facts, answerable questions")} rows={bars((s) => s.coverage)} fmt={pct} max={1} />
            <Chart title={t("Questions with every fact present")} hint={t("share of answerable questions")} rows={bars((s) => s.all_facts)} fmt={pct} max={1} />
            <Chart title={t("Answer page in the material")} hint={t("within one page of the answer key")} rows={bars((s) => s.page)} fmt={pct} max={1} />
            <Chart title={t("Material size (median tokens)")} hint={t("estimated; lower is faster and cheaper")} rows={bars((s) => s.tokens_est)} fmt={tok} />
            <Chart title={t("Repeated wording in the material")} hint={t("share of the text that repeats itself (e.g. the same sentence from two sources); lower is better")} rows={bars((s) => s.repeated).filter((r) => Number.isFinite(r.value))} fmt={pct} max={1} />
          </div>

          <div className="paper form-sheet">
            <h3 className="panel-title">🔎 {t("Every question")}</h3>
            <div style={{ overflowX: "auto" }}>
              <table className="bench-table">
                <thead><tr>
                  <th>{t("Questions")}</th><th>{t("Kind")}</th>
                  {sum.map((s) => <th key={s.condition} style={{ color: COND_COLOR[s.condition] }}>{t(COND_LABEL[s.condition])}</th>)}
                  <th>{t("Cards opened")}</th>
                </tr></thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.question_id}>
                      <td style={{ maxWidth: 360 }}>{r.q}{r.pages.length > 0 && <span className="muted"> ({t("p.")} {r.pages.map((p) => n(p)).join("، ")})</span>}</td>
                      <td>{t(CATEGORY_LABEL[r.category])}</td>
                      {sum.map((s) => {
                        const c = r.cells[s.condition];
                        if (r.category === "unanswerable") return <td key={s.condition}>{tok(c.tokens_est)}</td>;
                        const all = c.facts_findable > 0 && c.facts_found === c.facts_findable;
                        return (
                          <td key={s.condition} style={{ color: all ? "#2e7d4f" : c.facts_found === 0 ? "#b3202a" : undefined }}>
                            {n(c.facts_found)}/{n(c.facts_findable)} {c.page_in_context === true ? "· ✓" : c.page_in_context === false ? "· ✗" : ""}
                          </td>
                        );
                      })}
                      <td style={{ fontSize: 13 }}>{r.cells.uebai.topics?.join("، ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>{t("Each cell: facts found / facts findable in the whole book · ✓ the answer page is in the material.")}</p>
          </div>
        </section>
      )}
    </main>
  );
}
