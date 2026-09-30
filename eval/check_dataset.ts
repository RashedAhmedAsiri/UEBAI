/**
 * Sanity-checks a benchmark answer key against the book text stored in data/db.json:
 *  - every key fact of an answerable question should appear on (or next to) its cited pages
 *  - the key words of "unanswerable" questions should not appear anywhere in the book
 * It can't judge whether a question is good; a person still reviews each answer with the book.
 *
 * Usage:  npx tsx eval/check_dataset.ts eval/bench/biology1.json
 */
import crypto from "node:crypto";
import fs from "node:fs";
import { normalizeAnswer } from "../src/lib/bench/grade";
import type { BenchDataset } from "../src/lib/bench/types";
import type { DB } from "../src/lib/types";

const datasetPath = process.argv[2] ?? "eval/bench/biology1.json";
const ds = JSON.parse(fs.readFileSync(datasetPath, "utf8")) as BenchDataset;
const d = JSON.parse(fs.readFileSync(process.env.ROBOPROF_DATA_DIR ? `${process.env.ROBOPROF_DATA_DIR}/db.json` : "data/db.json", "utf8")) as DB;

// The book's paragraphs exist as soon as its text is extracted, even while topics are still being filed.
const source = d.sources.find((s) => s.status !== "failed" && (!ds.book_hint || s.filename.includes(ds.book_hint)) && d.paragraphs.some((p) => p.source_id === s.id));
if (!source) throw new Error(`No book with extracted text matches "${ds.book_hint}"`);
const pageText = new Map<number, string>();
for (const p of d.paragraphs.filter((x) => x.source_id === source.id)) pageText.set(p.page, (pageText.get(p.page) ?? "") + " " + p.text);
// PDF text often reverses the lam-alef ligature ("البالزموديوم" for "البلازموديوم"); fold both ways.
const fold = (s: string) => normalizeAnswer(s).replace(/لا/g, "ال");
const whole = fold([...pageText.values()].join(" "));

let problems = 0;
for (const q of ds.questions) {
  if (q.category === "unanswerable") {
    const words = normalizeAnswer(q.q).split(" ").filter((w) => w.length >= 6);
    const found = words.filter((w) => whole.includes(fold(w)));
    console.log(`${q.id} (unanswerable) — long words also in the book: ${found.join("، ") || "none"}`);
    continue;
  }
  const near = fold(q.pages.flatMap((p) => [p - 1, p, p + 1]).map((p) => pageText.get(p) ?? "").join(" "));
  const missing = q.facts.filter((f) => !f.split("|").some((alt) => near.includes(fold(alt))));
  if (missing.length) { problems++; console.log(`${q.id} p.${q.pages.join(",")} — facts not found near the page: ${missing.join(" ; ")}`); }
  else console.log(`${q.id} ok`);
}
console.log(problems ? `\n${problems} question(s) need a look (the PDF text may just be garbled there).` : "\nAll key facts were found on their pages.");
// Write this fingerprint (with the date) in your lab notebook before running: every report shows the
// fingerprint of the answer key it used, proving the key was not changed after seeing results.
console.log(`\nAnswer-key fingerprint (SHA-256): ${crypto.createHash("sha256").update(fs.readFileSync(datasetPath)).digest("hex")}`);
