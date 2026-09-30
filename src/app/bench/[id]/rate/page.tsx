"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, safeStorage } from "@/lib/client/api";
import { useI18n } from "@/lib/client/i18n";
import { GelButton, TubeProgress } from "@/components/skeuo";
import { toast } from "@/components/Toasts";
import { Markdown } from "@/components/Markdown";

interface Item {
  question_id: string;
  model: string | null;
  q: string;
  reference: string;
  answers: { id: string; text: string }[];
  rating: { scores: Record<string, number>; best: string | null } | null;
}

const LETTERS_AR = ["أ", "ب", "ج", "د", "هـ"];
const LETTERS_EN = ["A", "B", "C", "D", "E"];

/**
 * Blind rating sheet: a teacher scores each answer 1–5 against the answer key without knowing
 * which system wrote it. Every rater sees the answers in a different random order.
 */
export default function BlindRating({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { t, tm, n, lang } = useI18n();
  const [rater, setRater] = useState("");
  const [nameDraft, setNameDraft] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [best, setBest] = useState<string | null>(null);
  const letters = lang === "ar" ? LETTERS_AR : LETTERS_EN;

  useEffect(() => { const saved = safeStorage().get("uebai.rater"); if (saved) { setRater(saved); setNameDraft(saved); } }, []);
  useEffect(() => {
    if (!rater) return;
    api<{ items: Item[] }>(`/api/bench/${id}/rate?rater=${encodeURIComponent(rater)}`).then((d) => {
      setItems(d.items);
      const firstOpen = d.items.findIndex((x) => !x.rating);
      setIdx(firstOpen < 0 ? 0 : firstOpen);
    }).catch((e) => toast(tm((e as Error).message), "error"));
  }, [id, rater, tm]);

  const item = items?.[idx];
  useEffect(() => { setScores(item?.rating?.scores ?? {}); setBest(item?.rating?.best ?? null); }, [item]);

  if (!rater) {
    return (
      <main className="page">
        <h1 className="page-title emboss">🧑‍🏫 {t("Blind rating")}</h1>
        <section className="paper form-sheet" style={{ maxWidth: 560 }}>
          <p style={{ margin: 0 }}>{t("You will see a question, the answer key, and several answers written by different systems. You won't know which system wrote which. Give each answer a score from 1 (wrong) to 5 (correct and complete), then pick the best one.")}</p>
          <label className="field"><span>{t("Your name (so your ratings can be counted once)")}</span>
            <input className="typed-input" value={nameDraft} maxLength={60} onChange={(e) => setNameDraft(e.target.value)} />
          </label>
          <GelButton color="green" onClick={() => { const v = nameDraft.trim(); if (!v) return; safeStorage().set("uebai.rater", v); setRater(v); }}>{t("Start rating")}</GelButton>
        </section>
      </main>
    );
  }
  if (!items) return <main className="page"><p className="hand center">{t("Shuffling the answers…")}</p></main>;
  if (!items.length) return <main className="page"><p className="hand center">{t("There are no answers to rate yet.")} <Link href={`/bench/${id}`}>{t("Back to the report")}</Link></p></main>;

  const done = items.filter((x) => x.rating).length;
  const save = async () => {
    if (!item) return;
    if (item.answers.some((a) => !scores[a.id])) { toast(t("Give every answer a score from 1 to 5"), "error"); return; }
    try {
      await api(`/api/bench/${id}/rate`, { method: "POST", json: { rater, question_id: item.question_id, model: item.model, scores, best } });
      const next = items.map((x, i) => (i === idx ? { ...x, rating: { scores, best } } : x));
      setItems(next);
      const open = next.findIndex((x, i) => i > idx && !x.rating);
      if (open >= 0) setIdx(open);
      else if (idx < items.length - 1) setIdx(idx + 1);
      else toast(t("Thank you! All answers are rated."), "info");
    } catch (e) { toast(tm((e as Error).message), "error"); }
  };

  return (
    <main className="page">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
        <h1 className="page-title emboss">🧑‍🏫 {t("Blind rating")}</h1>
        <span className="hand">{t("Rater: {x}", { x: rater })} · <button className="metal-button" onClick={() => { setRater(""); setItems(null); }}>{t("Change")}</button></span>
      </div>
      <TubeProgress pct={(done / items.length) * 100} label={t("{a} of {b} rated", { a: n(done), b: n(items.length) })} />
      {item && (
        <section className="stack" style={{ marginTop: 16 }}>
          <div className="paper form-sheet">
            <div className="muted">{t("Question {a} of {b}", { a: n(idx + 1), b: n(items.length) })}{item.model && <span dir="ltr"> · {item.model}</span>}</div>
            <h2 style={{ margin: 0, fontSize: 24 }}>{item.q}</h2>
            <p style={{ margin: 0 }}><b>{t("Answer key")}:</b> {item.reference}</p>
          </div>
          <div className="bench-answers">
            {item.answers.map((a, k) => (
              <div key={a.id} className="index-card" style={{ cursor: "default", outline: best === a.id ? "3px solid #2e7d4f" : undefined }}>
                <b>{t("Answer {x}", { x: letters[k] })}</b>
                <div style={{ fontSize: 15, margin: "6px 0 10px" }}><Markdown>{a.text}</Markdown></div>
                <div className="row" style={{ gap: 6 }}>
                  {[1, 2, 3, 4, 5].map((s) => (
                    <button key={s} className="metal-button" aria-pressed={scores[a.id] === s} style={scores[a.id] === s ? { background: "#2e7d4f", color: "#fff" } : undefined} onClick={() => setScores({ ...scores, [a.id]: s })}>{n(s)}</button>
                  ))}
                  <label className="row" style={{ gap: 4, marginInlineStart: "auto" }}>
                    <input type="radio" name="best" checked={best === a.id} onChange={() => setBest(a.id)} /> {t("Best")}
                  </label>
                </div>
              </div>
            ))}
          </div>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <GelButton color="yellow" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>{t("Previous")}</GelButton>
            <GelButton color="green" size="lg" onClick={save}>{t("Save and next")}</GelButton>
            <GelButton color="blue" disabled={idx >= items.length - 1} onClick={() => setIdx(idx + 1)}>{t("Skip")}</GelButton>
          </div>
          <p className="muted" style={{ fontSize: 13 }}>{t("1 = wrong or invented · 3 = partly right · 5 = correct and complete. For questions the book does not answer, the best answer says so instead of guessing.")}</p>
        </section>
      )}
      <p><Link href={`/bench/${id}`}>{t("Back to the report")}</Link></p>
    </main>
  );
}
