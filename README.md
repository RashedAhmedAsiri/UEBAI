# UEBAI — Universal Educational Bots

Build a 3D robot teacher, dress it for its subject, program its personality, feed it your books — and learn in a chalkboard classroom. Books are digested **once** into a Topic Library: if two books both cover "Mammals", there is still **one** topic file, and each answer reads only the topic cards it needs.

*made by: Rashed Aseri* · © 2026, all rights reserved.

## SAIF 2026 results

Poster: [`docs/saif/poster/UEBAI-SAIF-poster.pdf`](docs/saif/poster/UEBAI-SAIF-poster.pdf)

Two Saudi Ministry of Education textbooks (Biology 1 and History), 5 Gemini models and 69 paired runs: the same question on the same model, once reading the whole book and once reading UEBAI's topic card. Answer keys were written before any run.

| Measure | UEBAI | Whole book | Result |
|---|---|---|---|
| Tokens per question | 2,994 | 160,273 | 55× fewer in 69/69 pairs, p < 0.0001 |
| Time to first word | 7.5 s | 13.3 s | faster in 49/69, p = 0.024 (median 2×) |
| Total time | 8.2 s | 13.8 s | faster in 48/69, p = 0.037 |
| Key facts recalled | 92% | 97% | not worse: 95% CI of the difference −9 to +1 points, inside the 10-point margin fixed in advance |
| Questions not in the book | 7/7 | 7/7 | both said so; no invented answers |

Adding the teacher's slides as a second source merged 27 slide topics into existing book cards and flagged 2 conflicts between the sources (e.g. fungi: 4 vs 5 phyla).

- Raw Proof Lab results: [`data/bench/`](data/bench/) · answer keys: [`eval/bench/`](eval/bench/)
- The textbooks themselves are **not** included: they belong to the Ministry of Education. To re-run an experiment, upload your own copy of the book in the app.

## Run it

Requirements: Node.js 20+ (tested on Node 24).

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000.

### Turn on the real AI (optional)

Without a key the app runs in **demo mode**: everything works offline, but answers quote the notes instead of being written by an AI. To enable a real AI, create `.env.local` next to `package.json` with **one** of:

```
GEMINI_API_KEY=...        # free — aistudio.google.com → Get API key
ANTHROPIC_API_KEY=sk-ant-...   # paid — console.anthropic.com
```

If both are set, Claude is used (override with `ROBOPROF_PROVIDER=gemini`). With Gemini, web search is off (the free tier has no Google Search quota; set `ROBOPROF_GEMINI_SEARCH=1` on a paid plan), and free-tier requests may be used by Google to improve its products.

Restart `npm run dev`. The "Demo mode" badge in the header disappears when the key is picked up. Models and merge thresholds can be changed in `.env.local` (see `.env.example`).

## Language

The site is **Arabic-first**: Arabic (right-to-left) is the default, and English is an optional translation (🌐 button in the header, remembered in a cookie). New teachers speak Arabic by default. All UI strings live in `src/lib/i18n/ar.ts` (keys are the English source text). `npm test` fails if any string is missing an Arabic translation or if an Arabic string contains English words.

## Try it in 2 minutes

1. **Staff Room** → *Make New Teacher*.
2. **Build** the robot (drawers on the left, paint + materials + proportion knobs on the right; drag to spin, scroll to zoom, 🎲 to randomize, Ctrl+Z to undo).
3. **Dress** → type a subject → *Dress for my subject*.
4. **Program** its personality (stamp a preset, tweak the dials, *Say hi* to preview).
5. **Assign** a subject, pick a knowledge mode on the brass lever, and drop the two Arabic books from `samples/` (`أساسيات الأحياء.md`, `ملاحظات علوم الحياة.md`) into the inbox tray. Watch «الثدييات» and «البناء الضوئي» get **merged** into single topics. (English samples are in `samples/` too.)
6. **Power On** → **Classroom**: ask «ما الثدييات التي تبيض؟». Click the sticky-note citation to see the source passage. The Brain Fuel gauge and teacher actions are under ⚙️ **Settings**. Open the **Library** to browse, merge (drag a card onto another), split, edit, export, or undo merges.

## Proof Lab (🔬 in the header) — does reading topic cards beat reading the whole book?

A fair, repeatable experiment: the **same model** answers the **same questions** about the **same book** with **identical instructions**, reading either the whole book, UEBAI's topic cards, classic equal-size chunks (same token budget as UEBAI), or only what fits a small context window. It records time to first word, total time, the provider's real token counts (incl. cached tokens), cost, how often a busy server refused the request, and answer quality three ways: key-fact recall computed by code from an answer key, a blind AI judge (answers shuffled, systems hidden), and a blind rating page for teachers. The report has medians, 95% CIs, paired sign-flip p-values, a per-question-kind breakdown, the one-time filing cost/break-even, and CSV/JSON export.

- Question sets live in `eval/bench/*.json` (`biology1.json`: 38 questions from randomly sampled pages of the grade-10 biology book, plus cross-page and not-in-the-book questions). Check an answer key against the stored book text with `npx tsx eval/check_dataset.ts eval/bench/biology1.json`.
- Command line (site must be running): `npx tsx eval/bench.ts --conditions full,uebai,rag --models gemini-3.6-flash --reps 3 --judge gemini-3.8-flash`.
- Free Gemini keys are tight (e.g. gemini-3.6-flash: 20 requests/day, 250k input tokens/minute). Runs pause when the daily quota is gone; press **Resume** the next day — nothing measured is lost.
- DeepSeek models (`deepseek-flash`, `deepseek-v4-pro`, 1M-token window) work too: add `DEEPSEEK_API_KEY` to `.env.local`.
- "Whole book" always reads every page: if a model's window is smaller than the book, the book is read in consecutive parts and the part answers are combined (timed as if the parts ran in parallel — the whole-book method's best case).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on port 3000 |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Unit tests (vitest) |
| `npm run typecheck` | TypeScript check |
| `npm run eval` | End-to-end retrieval + dedup eval (dev server must be running) |
| `npx tsx eval/bench.ts …` | Proof Lab benchmark from the command line |

## Where things live

```
src/app/                 pages (Staff Room, workshop, personality, subject, poweron, classroom, library, styleguide) + API routes
src/components/robot/    procedural 3D robot: parts, wardrobe, materials, face screen, stage
src/components/skeuo/    skeuomorphic UI components
src/lib/ai/              provider, models, prompts, personality compiler, router parsing
src/lib/server/          local DB, job runner, ingestion pipeline, library ops, tiered Q&A
src/lib/ingest/          pure cleaning / splitting / merge logic (unit-tested)
src/catalog/             parts.json, items.json, theme-packs.json
data/                    your local database + uploaded files (git-ignored)
data/bench/              Proof Lab results (published)
docs/                    ASSET_CREDITS.md, SAIF poster
```

Your data stays on your computer in `data/`. Delete that folder to start fresh.
