"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { useI18n } from "@/lib/client/i18n";
import { play } from "@/lib/client/sound";
import type { IngestReport, Job, Source } from "@/lib/types";
import { FolderModal, GelButton, MetalButton, RubberStamp, TubeProgress } from "@/components/skeuo";
import { toast } from "@/components/Toasts";

type SourceRow = Source & { job: Job | null };
interface Estimate { pages: number; tokens: number; scanned: boolean; live: boolean; usd: number; minutes: number }

const BAND: Record<string, string> = { pdf: "#d11c1c", docx: "#2b5c8a", pptx: "#d9661f", epub: "#6b2c8e", txt: "#5a5a5a", md: "#2e7d32" };
const KIND: Record<string, string> = { pdf: "PDF", docx: "Word", pptx: "Slides", epub: "E-book", txt: "Text", md: "Notes", markdown: "Notes", png: "Image", jpg: "Image", jpeg: "Image", webp: "Image", gif: "Image" };

/** Inbox tray: upload → estimate → confirm → live progress with the "reading" animation. */
export function SourcesTray({ teacherId, onChange }: { teacherId: string; onChange?: () => void }) {
  const { t, tm, n } = useI18n();
  const [rows, setRows] = useState<SourceRow[]>([]);
  const [over, setOver] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [pending, setPending] = useState<{ source: Source; estimate: Estimate; label: string }[]>([]);
  const [progress, setProgress] = useState<Record<string, Job["progress"] & { status: string; error: string | null }>>({});
  const [reports, setReports] = useState<Record<string, IngestReport>>({});
  const streams = useRef<Record<string, EventSource>>({});
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const d = await api<{ sources: SourceRow[] }>(`/api/teachers/${teacherId}/sources`);
    setRows(d.sources);
    return d.sources;
  }, [teacherId]);

  const watch = useCallback((jobId: string) => {
    if (streams.current[jobId]) return;
    const es = new EventSource(`/api/jobs/${jobId}/stream`);
    streams.current[jobId] = es;
    es.addEventListener("progress", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { status: string; progress: Job["progress"]; error: string | null };
      setProgress((p) => ({ ...p, [jobId]: { ...d.progress, status: d.status, error: d.error } }));
      if (d.progress.report) setReports((r) => ({ ...r, [jobId]: d.progress.report! }));
    });
    es.addEventListener("end", (e) => {
      const d = JSON.parse((e as MessageEvent).data) as { status: string };
      es.close(); delete streams.current[jobId];
      if (d.status === "done") { play("stamp"); toast(t("Filed into the Topic Library! 🗄️")); } else { play("error"); }
      void load(); onChange?.();
    });
    es.onerror = () => { es.close(); delete streams.current[jobId]; };
  }, [load, onChange, t]);

  useEffect(() => {
    void load().then((list) => list.forEach((s) => { if (s.job && (s.job.status === "queued" || s.job.status === "running")) watch(s.job.id); }));
    const all = streams.current;
    return () => Object.values(all).forEach((es) => es.close());
  }, [load, watch]);

  const upload = async (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      setUploading(file.name);
      play("paper");
      try {
        const fd = new FormData();
        fd.append("file", file);
        const d = await api<{ duplicate?: boolean; message?: string; source: Source; estimate?: Estimate }>(`/api/teachers/${teacherId}/sources`, { method: "POST", body: fd });
        if (d.duplicate) toast(t("“{file}” is already in the library — skipped.", { file: file.name }));
        else if (d.estimate) setPending((p) => [...p, { source: d.source, estimate: d.estimate!, label: d.source.label }]);
      } catch (e) { toast(tm((e as Error).message), "error"); }
    }
    setUploading(null);
    void load();
  };

  const confirm = async (i: number) => {
    const item = pending[i];
    try {
      const d = await api<{ job: Job }>(`/api/sources/${item.source.id}/confirm`, { method: "POST", json: { label: item.label } });
      setPending((p) => p.filter((_, j) => j !== i));
      play("clunk");
      watch(d.job.id);
      void load();
    } catch (e) { toast(tm((e as Error).message), "error"); }
  };

  const cancel = async (i: number) => {
    const item = pending[i];
    setPending((p) => p.filter((_, j) => j !== i));
    await api(`/api/sources/${item.source.id}`, { method: "DELETE" }).catch(() => {});
    void load();
  };

  const remove = async (s: SourceRow) => {
    if (!window.confirm(t("Remove “{file}” from the library? Topics built only from it will be removed.", { file: s.filename }))) return;
    try { await api(`/api/sources/${s.id}`, { method: "DELETE" }); toast(t("Removed.")); void load(); onChange?.(); }
    catch (e) { toast(tm((e as Error).message), "error"); }
  };

  const retry = async (s: SourceRow) => {
    try { const d = await api<{ job: Job }>(`/api/sources/${s.id}/confirm`, { method: "POST", json: {} }); watch(d.job.id); void load(); }
    catch (e) { toast(tm((e as Error).message), "error"); }
  };

  const active = rows.filter((s) => s.status === "queued" || s.status === "extracting" || s.status === "indexing");
  const est = pending[0]?.estimate;

  return (
    <div className="stack">
      <div
        className={`inbox-tray ${over ? "over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); if (e.dataTransfer.files.length) void upload(e.dataTransfer.files); }}
        onClick={() => input.current?.click()}
        role="button" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && input.current?.click()}
      >
        <span className="tray-label brass-plaque"><span className="label">{t("Inbox tray")}</span></span>
        <span style={{ fontSize: 44 }} aria-hidden>📥</span>
        <b className="emboss" style={{ color: "#fff", textShadow: "0 -1px 0 #000" }}>{uploading ? t("Receiving {file}…", { file: uploading }) : t("Drop books & notes here")}</b>
        <span style={{ fontSize: 13, opacity: .85 }}>{t("Books, Word files, slides, e-books, text notes and photos — up to 500 MB")}</span>
        <input ref={input} type="file" multiple hidden accept=".pdf,.docx,.pptx,.epub,.txt,.md,.markdown,.png,.jpg,.jpeg,.webp,.gif" onChange={(e) => e.target.files && upload(e.target.files)} />
      </div>

      {active.length > 0 && (
        <div className="reading-anim paper" aria-hidden>
          <span className="book">📖</span><span className="cabinet">🗄️</span>
          <span className="page-fly">📄</span><span className="page-fly">📄</span><span className="page-fly">📄</span>
        </div>
      )}

      {rows.map((s) => {
        const ext = s.filename.split(".").pop()?.toLowerCase() ?? "";
        const pr = s.job ? progress[s.job.id] : undefined;
        const report = s.job ? reports[s.job.id] ?? s.job.progress.report : undefined;
        const running = s.status === "queued" || s.status === "extracting" || s.status === "indexing";
        return (
          <div key={s.id} className="file-row paper">
            <span className="file-icon" style={{ ["--band" as string]: BAND[ext] ?? "#888" }}><span className="band" />{t(KIND[ext] ?? "File")}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.filename}</div>
              <div className="muted typewriter" style={{ fontSize: 12 }}>
                “{s.label}” · {t("{n} pages", { n: n(s.pages) })} · {t("~{n} tokens", { n: n(s.token_estimate) })}
              </div>
              {running && <div style={{ marginTop: 6 }}><TubeProgress pct={pr?.pct ?? 2} label={tm(pr?.message ?? s.job?.progress.message ?? "Processing")} /></div>}
              {s.status === "failed" && <div className="hand" style={{ color: "#b3202a" }}>⚠ {tm(s.error ?? "")}</div>}
              {s.status === "awaiting_confirm" && !pending.some((p) => p.source.id === s.id) && (
                <div className="hand muted">{t("Waiting for your OK…")} <button className="metal-button" style={{ padding: "2px 8px" }} onClick={() => retry(s)}>{t("Start reading")}</button></div>
              )}
              {s.status === "ready" && report && (
                <div className="hand" style={{ fontSize: 15 }}>
                  {t("Read {pages} pages → {topics} topics · {merged} merged with existing · {units} new units", {
                    pages: n(report.pages), topics: n(report.topics), merged: n(report.merged), units: n(report.new_units),
                  })}
                  {report.skipped_paragraphs ? ` · ${t("{n} duplicate paragraphs skipped", { n: n(report.skipped_paragraphs) })}` : ""}
                  {report.merged > 0 && <> <RubberStamp animate color="#b3202a">{t("Merged")}</RubberStamp></>}
                </div>
              )}
            </div>
            <div className="row" style={{ gap: 6 }}>
              {s.status === "ready" && <RubberStamp color="#2e7d4f">{t("Ready")}</RubberStamp>}
              {s.status === "failed" && <MetalButton onClick={() => retry(s)}>↻ {t("Retry")}</MetalButton>}
              {!running && <MetalButton onClick={() => remove(s)} aria-label={t("Remove")}>🗑</MetalButton>}
            </div>
          </div>
        );
      })}

      {pending[0] && est && (
        <FolderModal tab={t("Cost estimate")} onClose={() => cancel(0)}>
          <div className="stack">
            <h2 className="typewriter">{pending[0].source.filename}</h2>
            <div className="two-col">
              <div className="stack typewriter" style={{ fontSize: 16 }}>
                <div>{t("Pages")}: <b>{n(est.pages)}</b></div>
                <div>{t("Text")}: <b>{t("~{n} tokens", { n: n(est.tokens) })}</b>{est.scanned && ` (${t("scanned — needs OCR")})`}</div>
                <div>{t("Estimated cost")}: <b>{est.live ? t("≈ {usd} dollars", { usd: n(Number(est.usd.toFixed(2))) }) : t("Free (demo mode, offline)")}</b></div>
                <div>{t("Time")}: <b>{t("~{n} min", { n: n(est.minutes) })}</b></div>
              </div>
              <label className="field">
                <span>{t("Short name for citations")}</span>
                <input className="typed-input" maxLength={32} value={pending[0].label} onChange={(e) => setPending((p) => p.map((x, j) => (j === 0 ? { ...x, label: e.target.value } : x)))} />
                <span className="hand muted">{t("Answers will cite it like “📕 {label} · p.12”.", { label: pending[0].label })}</span>
              </label>
            </div>
            <p className="hand">{t("The robot reads the book once, files every topic into the library, and merges topics other books already cover.")}</p>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <GelButton color="red" onClick={() => cancel(0)}>{t("Cancel")}</GelButton>
              <GelButton color="green" onClick={() => confirm(0)}>📖 {t("Start reading")}</GelButton>
            </div>
          </div>
        </FolderModal>
      )}
    </div>
  );
}
