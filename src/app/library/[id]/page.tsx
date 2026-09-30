"use client";
import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/client/api";
import { useI18n } from "@/lib/client/i18n";
import { play } from "@/lib/client/sound";
import { useTeacher } from "@/lib/client/useTeacher";
import type { MergeLogEntry, Passage, Topic, TopicLink, Unit } from "@/lib/types";
import { BrassPlaque, FolderModal, GelButton, MetalButton, RubberStamp } from "@/components/skeuo";
import { Markdown } from "@/components/Markdown";
import { toast } from "@/components/Toasts";

type TopicRow = Omit<Topic, "paragraph_ids"> & { passage_count: number };
const ACTION_LABEL: Record<string, string> = { merge: "merge", manual_merge: "manual merge", split: "split", related: "related", subtopic: "subtopic" };
type LogRow = Omit<MergeLogEntry, "snapshot" | "candidate"> & { candidate_title: string | null; snapshot_titles: string[] };
interface Tree { units: Unit[]; topics: TopicRow[]; links: TopicLink[]; stats: { pages: number; topics: number; merges: number; tokens_saved: number; questions: number }; merge_log: LogRow[] }
interface Detail {
  topic: TopicRow;
  sources: { source_id: string; page_start: number; page_end: number; label: string; filename: string }[];
  related: { id: string; title: string }[];
  children: { id: string; title: string }[];
  parent: { id: string; title: string } | null;
  passages: (Passage & { label: string })[];
}

export default function LibraryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const search = useSearchParams();
  const { t, tm, n, lang } = useI18n();
  const { teacher } = useTeacher(id);
  const [tree, setTree] = useState<Tree | null>(null);
  const [openUnits, setOpenUnits] = useState<Set<string>>(new Set());
  const [openTopic, setOpenTopic] = useState<string | null>(search.get("topic"));
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [showLog, setShowLog] = useState(false);

  const load = useCallback(async () => {
    const d = await api<Tree>(`/api/teachers/${id}/topics`);
    setTree(d);
    return d;
  }, [id]);

  useEffect(() => {
    void load().then((d) => {
      const first = search.get("topic");
      const unit = first ? d.topics.find((x) => x.id === first)?.unit_id : d.units[0]?.id;
      setOpenUnits(new Set([unit ?? "__unfiled"]));
    }).catch((e) => toast(tm((e as Error).message), "error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // While rebuilds are running, keep refreshing.
  const dirty = tree?.topics.some((x) => x.dirty) ?? false;
  useEffect(() => {
    if (!dirty) return;
    const iv = setInterval(() => void load(), 2000);
    return () => clearInterval(iv);
  }, [dirty, load]);

  const groups = useMemo(() => {
    if (!tree) return [];
    const f = filter.trim().toLowerCase();
    const match = (x: TopicRow) => !f || [x.title, ...x.aliases, ...x.keywords, x.card_summary].some((s) => s.toLowerCase().includes(f));
    const byUnit = tree.units.map((u) => ({ unit: u, topics: tree.topics.filter((x) => x.unit_id === u.id && match(x)) }));
    const unfiled = tree.topics.filter((x) => (!x.unit_id || !tree.units.some((u) => u.id === x.unit_id)) && match(x));
    if (unfiled.length) byUnit.push({ unit: { id: "__unfiled", teacher_id: id, title: t("Unfiled"), order_index: 999 }, topics: unfiled });
    return byUnit.filter((g) => g.topics.length || !f);
  }, [tree, filter, id, t]);

  const merge = async (from: string, into: string) => {
    if (from === into || !tree) return;
    const a = tree.topics.find((x) => x.id === from), b = tree.topics.find((x) => x.id === into);
    if (!window.confirm(t("Merge “{a}” into “{b}”? (You can undo this from the merge log.)", { a: a?.title ?? "", b: b?.title ?? "" }))) return;
    try {
      await api("/api/topics/merge", { method: "POST", json: { from, into } });
      play("stamp");
      toast(t("Merged into one topic file! 🗂️"));
      void load();
    } catch (e) { toast(tm((e as Error).message), "error"); }
  };

  const undo = async (logId: string) => {
    try { await api(`/api/merge-log/${logId}/undo`, { method: "POST" }); play("drawer"); toast(t("Undone ↶")); void load(); }
    catch (e) { toast(tm((e as Error).message), "error"); }
  };

  if (!tree || !teacher) return <main className="page"><p className="hand center">{t("Pulling out the card catalog…")}</p></main>;

  return (
    <main className="page">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
        <h1 className="page-title emboss" style={{ margin: 0 }}>🗄️ {t("Library")} · {teacher.title} {teacher.name}</h1>
        <div className="row">
          <Link className="metal-button" href={`/subject/${id}`}>📥 {t("Add books")}</Link>
          <Link className="metal-button" href={`/classroom/${id}`}>🏫 {t("Classroom")}</Link>
        </div>
      </div>

      <div className="row" style={{ gap: 14, marginBottom: 16, justifyContent: "center" }}>
        <BrassPlaque value={n(tree.stats.pages)} label={t("Pages read")} />
        <BrassPlaque value={n(tree.stats.topics)} label={t("Topics")} />
        <BrassPlaque value={n(tree.stats.merges)} label={t("Merges")} />
        <BrassPlaque value={n(tree.stats.tokens_saved)} label={t("Tokens saved")} />
      </div>

      <div className="cabinet wood-dark">
        <div className="row">
          <input className="typed-input" style={{ background: "#fffdf5", padding: "8px 12px", borderRadius: 4, maxWidth: 340 }} placeholder={t("🔍 Find a card…")} value={filter} onChange={(e) => setFilter(e.target.value)} />
          <span className="hand" style={{ color: "#f6e7cf" }}>{t("Drag a card onto another to merge")}</span>
          <span className="grow" />
          <MetalButton onClick={() => setShowLog(true)}>📜 {t("Merge log")} ({n(tree.merge_log.filter((m) => !m.undone).length)})</MetalButton>
        </div>

        {!tree.topics.length && (
          <div className="center" style={{ padding: 30 }}>
            <div className="sticky-note" style={{ fontSize: 20 }}>{t("No topic cards yet! Drop a book into the inbox tray on the")} <Link href={`/subject/${id}`}>{t("Subject Desk")}</Link>.</div>
          </div>
        )}

        {groups.map(({ unit, topics }) => {
          const open = openUnits.has(unit.id) || !!filter;
          return (
            <div key={unit.id} className="cabinet-drawer">
              <button className="front" onClick={() => { play("drawer"); setOpenUnits((s) => { const n = new Set(s); if (n.has(unit.id)) n.delete(unit.id); else n.add(unit.id); return n; }); }} aria-expanded={open}>
                <span className="label-holder">{unit.title}</span>
                <span className="emboss" style={{ fontWeight: 700 }}>{t("{n} cards", { n: n(topics.length) })}</span>
                <span className="pull" />
              </button>
              {open && (
                <div className="cards">
                  {topics.map((x) => {
                    const merges = tree.merge_log.filter((m) => m.into_topic_id === x.id && m.action === "merge" && !m.undone).length;
                    return (
                      <button
                        key={x.id}
                        className={`index-card ${dragId === x.id ? "dragging" : ""} ${dropId === x.id ? "drop-target" : ""}`}
                        draggable
                        onDragStart={(e) => { setDragId(x.id); e.dataTransfer.setData("text/plain", x.id); play("paper"); }}
                        onDragEnd={() => { setDragId(null); setDropId(null); }}
                        onDragOver={(e) => { if (dragId && dragId !== x.id) { e.preventDefault(); setDropId(x.id); } }}
                        onDragLeave={() => setDropId((d) => (d === x.id ? null : d))}
                        onDrop={(e) => { e.preventDefault(); const from = e.dataTransfer.getData("text/plain"); setDropId(null); void merge(from, x.id); }}
                        onClick={() => { play("paper"); setOpenTopic(x.id); }}
                      >
                        {x.parent_topic_id && <span className="tab">↳ {tree.topics.find((p) => p.id === x.parent_topic_id)?.title ?? t("subtopic")}</span>}
                        <h4>{x.dirty ? <span className="spin">⚙️</span> : "📇"} {x.title}</h4>
                        <div style={{ maxHeight: 84, overflow: "hidden" }}>{x.dirty ? t("Being rewritten…") : x.card_summary}</div>
                        <div className="muted" style={{ fontSize: 11 }}>{t("{s} sources · {p} passages · ~{k} tokens", { s: n(x.source_refs.length), p: n(x.passage_count), k: n(x.notes_tokens) })}{x.notes_user_edited ? ` · ✎ ${t("edited")}` : ""}</div>
                        {merges > 0 && <span className="rubber-stamp merge-stamp">{t("Merged ×{n}", { n: n(merges) })}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {openTopic && <TopicFolder topicId={openTopic} units={tree.units} onClose={() => setOpenTopic(null)} onChanged={load} onOpen={setOpenTopic} />}

      {showLog && (
        <FolderModal tab={t("Merge log")} onClose={() => setShowLog(false)}>
          <h2 className="typewriter" style={{ marginBottom: 10 }}>📜 {t("Merge log")}</h2>
          {!tree.merge_log.length && <p className="hand">{t("Nothing merged yet.")}</p>}
          <div className="stack">
            {tree.merge_log.map((m) => (
              <div key={m.id} className="row paper" style={{ padding: 10, borderRadius: 4, opacity: m.undone ? 0.55 : 1 }}>
                <RubberStamp color={m.action === "merge" || m.action === "manual_merge" ? "#b3202a" : m.action === "split" ? "#6b2c8e" : "#2b5c8a"}>{t(ACTION_LABEL[m.action] ?? m.action)}</RubberStamp>
                <div className="grow" style={{ minWidth: 200 }}>
                  <div className="typewriter" style={{ fontSize: 14 }}>
                    {m.action === "merge" ? `“${m.candidate_title}” → “${tree.topics.find((x) => x.id === m.into_topic_id)?.title ?? m.snapshot_titles[0] ?? "?"}”` : tm(m.reason)}
                  </div>
                  <div className="muted" style={{ fontSize: 12 }}>{m.action === "merge" && tm(m.reason)} · {new Date(m.created_at).toLocaleString(lang === "ar" ? "ar-SA" : "en-US")}</div>
                </div>
                {m.undone ? <span className="hand">{t("undone")}</span> : <GelButton size="xs" color="yellow" onClick={() => undo(m.id)}>↶ {t("Undo merge")}</GelButton>}
              </div>
            ))}
          </div>
        </FolderModal>
      )}
    </main>
  );
}

function TopicFolder({ topicId, units, onClose, onChanged, onOpen }: { topicId: string; units: Unit[]; onClose: () => void; onChanged: () => Promise<unknown>; onOpen: (id: string) => void }) {
  const { t, tm, n } = useI18n();
  const [d, setD] = useState<Detail | null>(null);
  const [edit, setEdit] = useState(false);
  const [notes, setNotes] = useState("");
  const [title, setTitle] = useState("");
  const [diff, setDiff] = useState<{ proposal: string; current: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"notes" | "passages">("notes");

  const load = useCallback(async () => {
    const r = await api<Detail>(`/api/topics/${topicId}`);
    setD(r); setNotes(r.topic.notes_md); setTitle(r.topic.title);
  }, [topicId]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => { void load().catch((e) => { toast(tm((e as Error).message), "error"); closeRef.current(); }); }, [load, tm]);
  const isDirty = d?.topic.dirty ?? false;
  useEffect(() => {
    if (!isDirty) return;
    const iv = setInterval(() => void load().catch(() => {}), 2000);
    return () => clearInterval(iv);
  }, [isDirty, load]);

  const patchTopic = async (body: Record<string, unknown>, msg: string) => {
    try { await api(`/api/topics/${topicId}`, { method: "PATCH", json: body }); toast(t(msg)); play("stamp"); await load(); await onChanged(); }
    catch (e) { toast(tm((e as Error).message), "error"); }
  };

  const regenerate = async () => {
    setBusy(true);
    try {
      const r = await api<{ applied: boolean; proposal?: string; current?: string }>(`/api/topics/${topicId}/regenerate`, { method: "POST", json: {} });
      if (r.applied) { toast(t("Fresh notes written ✨")); await load(); await onChanged(); }
      else setDiff({ proposal: r.proposal!, current: r.current! });
    } catch (e) { toast(tm((e as Error).message), "error"); }
    finally { setBusy(false); }
  };

  const split = async () => {
    const raw = window.prompt(t("Split into which subtopics? (comma-separated, at least 2)"), "");
    if (!raw) return;
    try { await api(`/api/topics/${topicId}/split`, { method: "POST", json: { titles: raw.split(/[,،]/) } }); toast(t("Split! New cards are being written ✂")); await onChanged(); onClose(); }
    catch (e) { toast(tm((e as Error).message), "error"); }
  };

  const del = async () => {
    if (!window.confirm(t("Delete the topic “{title}”? Its passages leave the library.", { title: d?.topic.title ?? "" }))) return;
    try { await api(`/api/topics/${topicId}`, { method: "DELETE" }); toast(t("Deleted.")); await onChanged(); onClose(); }
    catch (e) { toast(tm((e as Error).message), "error"); }
  };

  if (!d) return <FolderModal tab="…" onClose={onClose}><p className="hand">{t("Opening the folder…")}</p></FolderModal>;
  const x = d.topic;
  return (
    <FolderModal tab={x.title.slice(0, 40)} onClose={onClose} wide>
      <div className="stack">
        <div className="row">
          <input className="typed-input grow" style={{ fontSize: 24, fontWeight: 700 }} value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t("Rename")} />
          {title !== x.title && <GelButton size="xs" color="green" onClick={() => patchTopic({ title }, "Renamed ✎")}>{t("Rename")}</GelButton>}
        </div>
        {x.aliases.length > 0 && <div className="muted typewriter" style={{ fontSize: 13 }}>{t("Also known as")}: {x.aliases.join(" · ")}</div>}
        <div className="index-card" style={{ cursor: "default" }}><h4>{t("Tier 1 · Index card")}</h4>{x.card_summary}<div className="muted">🔑 {x.keywords.join(", ")}</div></div>

        <div className="row">
          <MetalButton active={tab === "notes"} onClick={() => setTab("notes")}>📝 {t("Tier 2 · Study notes")}</MetalButton>
          <MetalButton active={tab === "passages"} onClick={() => setTab("passages")}>📄 {t("Tier 3 · Passages")} ({n(d.passages.length)})</MetalButton>
          <span className="grow" />
          <select className="metal-button" value={x.unit_id ?? ""} onChange={(e) => {
            const v = e.target.value;
            if (v === "__new") { const name = window.prompt(t("New unit name")); if (name) void patchTopic({ unit_title: name }, "Moved 📦"); }
            else void patchTopic({ unit_id: v || null }, "Moved 📦");
          }} aria-label={t("Move")}>
            {units.map((u) => <option key={u.id} value={u.id}>📦 {u.title}</option>)}
            <option value="">📦 {t("Unfiled")}</option>
            <option value="__new">＋ {t("New unit…")}</option>
          </select>
        </div>

        {tab === "notes" ? (
          edit ? (
            <>
              <textarea className="typed-textarea" style={{ minHeight: 320, fontSize: 14 }} value={notes} onChange={(e) => setNotes(e.target.value)} />
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <GelButton size="sm" color="red" onClick={() => { setEdit(false); setNotes(x.notes_md); }}>{t("Cancel")}</GelButton>
                <GelButton size="sm" color="green" onClick={async () => { await patchTopic({ notes_md: notes }, "Notes saved ✎"); setEdit(false); }}>{t("Save")}</GelButton>
              </div>
            </>
          ) : (
            <div className="lined-paper" style={{ padding: "10px 50px 10px 16px", borderRadius: 3 }}>
              {x.dirty ? <p className="hand"><span className="spin">⚙️</span> {t("The robot is rewriting these notes…")}</p> : <Markdown>{x.notes_md || t("_No notes yet._")}</Markdown>}
            </div>
          )
        ) : (
          <div className="stack" style={{ maxHeight: 420, overflow: "auto" }}>
            {d.passages.map((p) => (
              <div key={p.id} className="paper" style={{ padding: 10, borderRadius: 3 }}>
                <div className="typewriter" style={{ fontSize: 12, marginBottom: 4 }}>📕 {t("{source} · p.{page}", { source: p.label, page: p.page_end !== p.page_start ? `${n(p.page_start)}–${n(p.page_end)}` : n(p.page_start) })} · {t("~{n} tokens", { n: n(p.tokens) })}</div>
                <div style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{p.text}</div>
              </div>
            ))}
          </div>
        )}

        <div className="two-col">
          <div>
            <div className="field-label">{t("Sources")}</div>
            {d.sources.map((s) => <div key={s.source_id} className="typewriter" style={{ fontSize: 14 }}>📕 {s.label} — {t("pages {a}–{b}", { a: n(s.page_start), b: n(s.page_end) })} <span className="muted">({s.filename})</span></div>)}
          </div>
          <div>
            <div className="field-label">{t("Related")}</div>
            <div className="row">
              {d.parent && <button className="topic-book" onClick={() => onOpen(d.parent!.id)}>⬆ {d.parent.title}</button>}
              {d.children.map((c) => <button key={c.id} className="topic-book" onClick={() => onOpen(c.id)}>↳ {c.title}</button>)}
              {d.related.map((r) => <button key={r.id} className="topic-book" onClick={() => onOpen(r.id)}>📌 {r.title}</button>)}
              {!d.parent && !d.children.length && !d.related.length && <span className="muted">—</span>}
            </div>
          </div>
        </div>

        <div className="row" style={{ justifyContent: "flex-end", borderTop: "1px dashed #b9a07a", paddingTop: 10 }}>
          {!edit && <GelButton size="sm" color="blue" onClick={() => setEdit(true)}>✎ {t("Edit notes")}</GelButton>}
          <GelButton size="sm" color="purple" onClick={regenerate} disabled={busy}>{busy ? "…" : `✨ ${t("Regenerate")}`}</GelButton>
          <GelButton size="sm" color="orange" onClick={split}>✂ {t("Split")}</GelButton>
          <a className="gel-button gel-teal gel-sm" href={`/api/topics/${topicId}/export`} onClick={() => play("paper")}>⬇ {t("Export .md")}</a>
          <GelButton size="sm" color="red" onClick={del}>🗑 {t("Delete")}</GelButton>
        </div>
      </div>

      {diff && (
        <FolderModal tab={t("Regenerate")} onClose={() => setDiff(null)} wide>
          <h2 className="typewriter">{t("You edited these notes — pick a version")}</h2>
          <p className="hand">{t("Regeneration never overwrites your edits silently.")}</p>
          <div className="diff">
            <div><div className="field-label">{t("Your version")}</div><pre>{diff.current}</pre></div>
            <div><div className="field-label">{t("New AI version")}</div><pre>{diff.proposal}</pre></div>
          </div>
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
            <GelButton color="yellow" onClick={() => setDiff(null)}>{t("Keep mine")}</GelButton>
            <GelButton color="green" onClick={async () => {
              await api(`/api/topics/${topicId}/regenerate`, { method: "POST", json: { accept: diff.proposal } });
              setDiff(null); toast(t("New notes accepted ✨")); await load(); await onChanged();
            }}>{t("Use new version")}</GelButton>
          </div>
        </FolderModal>
      )}
    </FolderModal>
  );
}
