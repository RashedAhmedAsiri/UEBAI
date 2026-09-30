import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db, now, save, uid } from "./db";
import { client, completeJson, describeAiError, isLive } from "../ai/provider";
import { MODELS, provider, supportsEffort, webSearchToolType } from "../ai/models";
import { routerPrompt, studyNotesBlock, teacherSystemPrompt, catalogLines } from "../ai/prompts";
import { heuristicRoute, parseRoute, type RouteResult } from "../ai/route";
import { Bm25, estimateTokens, sentences, stripInternalIds, stripTashkeel, tokenize } from "../text";
import type { Citation, Message, Passage, RobotState, Source, Teacher, Topic } from "../types";

export type ChatEvent =
  | { type: "route"; decision: RouteResult["decision"]; topics: { id: string; title: string }[] }
  | { type: "robot_state"; state: RobotState }
  | { type: "token"; text: string }
  | { type: "tool"; name: string; detail: string }
  | { type: "citation"; citation: Citation }
  | { type: "meter"; tokens_in: number; tokens_out: number; baseline: number; tiers: number[]; saved_total: number }
  | { type: "done"; message: Message }
  | { type: "error"; message: string };

const CATALOG_FULL_LIMIT = 150;

const SearchInput = z.object({ query: z.string().min(1), topic_id: z.string().optional() });
const OpenInput = z.object({ topic_id: z.string().min(1) });

export function readyTopics(teacherId: string) {
  return db().topics.filter((t) => t.teacher_id === teacherId && t.notes_md);
}

function baselineTokens(teacherId: string) {
  return db().sources.filter((s) => s.teacher_id === teacherId && s.status === "ready").reduce((n, s) => n + s.token_estimate, 0);
}

export function searchPassages(teacherId: string, query: string, topicId?: string, k = 4): Passage[] {
  const pool = db().passages.filter((p) => p.teacher_id === teacherId && (!topicId || p.topic_id === topicId));
  const index = new Bm25(pool.map((p) => ({ id: p.id, text: p.text })));
  const byId = new Map(pool.map((p) => [p.id, p]));
  return index.search(query, k).map((r) => byId.get(r.id)!);
}

function formatPassages(passages: Passage[], sources: Map<string, Source>) {
  if (!passages.length) return "No matching passages found.";
  return `<passages>\n${passages.map((p) => {
    const pages = p.page_start === p.page_end ? `p.${p.page_start}` : `p.${p.page_start}-${p.page_end}`;
    return `[${sources.get(p.source_id)?.label ?? "Source"} ${pages}]\n${p.text}`;
  }).join("\n\n")}\n</passages>`;
}

function cardIndexFor(topics: Topic[]) {
  return new Bm25(topics.map((t) => ({ id: t.id, text: `${t.title} ${t.title} ${t.aliases.join(" ")} ${t.keywords.join(" ")} ${t.card_summary}` })));
}

/**
 * Keyword router (no AI call): BM25 over the topic cards plus votes from matching book passages,
 * with a strong boost when the question names a topic title. Returns up to 2 topic ids.
 * Also used by the Proof Lab benchmark, so it measures exactly what the teacher does.
 */
export function keywordRoute(teacherId: string, topics: Topic[], question: string): string[] {
  if (!topics.length) return [];
  const qTokens = new Set(tokenize(question));
  const titleHit = (id: string) => {
    const t = topics.find((x) => x.id === id)!;
    return [t.title, ...t.aliases].some((name) => { const nt = tokenize(name); return nt.length > 0 && nt.every((w) => qTokens.has(w)); });
  };
  const scores = new Map<string, number>();
  for (const h of cardIndexFor(topics).search(question, 8)) scores.set(h.id, h.score + (titleHit(h.id) ? 10 : 0));
  // Passages vote too: cards are tiny, the original text knows the details ("marsupial", "fermentation").
  const pool = db().passages.filter((p) => p.teacher_id === teacherId);
  for (const h of new Bm25(pool.map((p) => ({ id: p.id, text: p.text }))).search(question, 6)) {
    const tid = pool.find((p) => p.id === h.id)!.topic_id;
    if (topics.some((t) => t.id === tid)) scores.set(tid, Math.max(scores.get(tid) ?? 0, (scores.get(tid) ?? 0) + h.score * 0.8));
  }
  for (const [tid, s] of scores) if (titleHit(tid) && s < 10) scores.set(tid, s + 10);
  const hits = [...scores].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score);
  const top = hits[0]?.score ?? 0;
  return hits.filter((h) => h.score >= Math.max(1.5, top * 0.6)).map((h) => h.id).slice(0, 2);
}

/** Tier-1 routing. Small model over the (cached) card catalog; BM25 prefilter for big libraries. */
async function route(teacher: Teacher, topics: Topic[], active: Topic[], question: string): Promise<RouteResult> {
  const valid = new Set(topics.map((t) => t.id));
  const h = heuristicRoute(question, active.length > 0);
  if (h) return { decision: h, topic_ids: h === "same_as_before" ? active.map((t) => t.id) : [], needs_detail: false, search_query: question };
  if (!topics.length) return { decision: "none", topic_ids: [], needs_detail: false, search_query: question };

  // On Gemini's free tier an LLM routing call adds 5–10s and spends daily quota; keyword routing is
  // instant, and the teacher can still open_topic / search_passages if it picked wrong.
  if (!isLive() || provider() === "gemini") {
    const chosen = keywordRoute(teacher.id, topics, question);
    return { decision: chosen.length ? "topics" : "none", topic_ids: chosen, needs_detail: false, search_query: question };
  }

  const cardIndex = cardIndexFor(topics);
  let cards = topics;
  if (topics.length > CATALOG_FULL_LIMIT) {
    // Card search + passage search both vote for candidate topics.
    const ids = new Set(cardIndex.search(question, 8).map((h) => h.id));
    for (const p of searchPassages(teacher.id, question, undefined, 6)) ids.add(p.topic_id);
    cards = topics.filter((t) => ids.has(t.id));
  }
  const p = routerPrompt(teacher.subject.name || "general", active, cards, question);
  const { data } = await completeJson<unknown>({
    role: "router",
    maxTokens: 300,
    // Catalog goes in a cached system block: stable across questions.
    system: [
      { type: "text", text: p.system },
      { type: "text", text: p.catalog, cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: p.question }],
  });
  return parseRoute(data, valid, question);
}

/** Validate refs like [Biology 1 p.142] against real sources + pages we actually loaded. */
function validateCitations(text: string, teacher: Teacher, loaded: Topic[], passagesSeen: Passage[], sources: Source[]): Citation[] {
  const byLabel = new Map(sources.map((s) => [stripTashkeel(s.label.trim().toLowerCase()), s]));
  const out: Citation[] = [];
  const seen = new Set<string>();
  // Refs look like [Biology 1 p.142] or, in Arabic notes, [الأحياء ١ ص.١٤٢]; Arabic-Indic digits are normalized.
  const latinDigits = (s: string) => s.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660));
  // Replies are written with tashkeel; refs are matched without it.
  for (const m of latinDigits(stripTashkeel(text)).matchAll(/\[([^[\]]{2,160})\]/g)) {
    for (const part of m[1].split(/[;؛]/)) {
      const r = part.trim().match(/^(.+?)\s+(?:p\.|ص\.?)\s?(\d+)(?:\s*[-–]\s*\d+)?$/);
      if (!r) continue;
      const source = byLabel.get(r[1].trim().toLowerCase());
      if (!source) continue;
      const page = Number(r[2]);
      const topic = loaded.find((t) => t.source_refs.some((sr) => sr.source_id === source.id && page >= sr.page_start && page <= sr.page_end));
      const onPage = (p: Passage) => p.source_id === source.id && page >= p.page_start && page <= p.page_end;
      // Prefer a passage from the cited topic (several topics can share one page).
      const passage = (topic && (passagesSeen.find((p) => p.topic_id === topic.id && onPage(p)) ?? db().passages.find((p) => p.topic_id === topic.id && onPage(p))))
        ?? passagesSeen.find(onPage)
        ?? db().passages.find((p) => p.teacher_id === teacher.id && onPage(p));
      if (!topic && !passage) continue; // hallucinated page → dropped
      const key = `${source.id}:${page}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const tTitle = topic?.title ?? db().topics.find((t) => t.id === passage?.topic_id)?.title;
      out.push({
        kind: "book", source_id: source.id, source_label: source.label, page, topic_id: topic?.id ?? passage?.topic_id, topic_title: tTitle,
        label: `${source.label} · p.${page}${tTitle ? ` · ${tTitle}` : ""}`,
        passage: passage?.text.slice(0, 1200),
      });
    }
  }
  return out;
}

const speaksArabic = (t: Teacher) => t.personality.language.primary === "ar";

/** Section of Markdown notes under a heading (Arabic or English heading names). */
export function notesSection(notes: string, names: string[]): string | null {
  for (const n of names) {
    const part = notes.split(`### ${n}`)[1];
    if (part !== undefined) return part.split("###")[0].trim();
  }
  return null;
}

function demoAnswer(teacher: Teacher, r: RouteResult, loaded: Topic[], allTopics: Topic[], question: string): string {
  const p = teacher.personality;
  const ar = speaksArabic(teacher);
  const hello = p.catchphrases[0] ? `${p.catchphrases[0]} ` : "";
  const subject = teacher.subject.name || (ar ? "كل شيء" : "anything");
  if (r.decision === "chitchat") {
    return ar
      ? `${hello}أهلًا وسهلًا! أنا ${p.title} ${p.name}. دوائري تطنّ حماسًا لتعليم ${subject}. ماذا تحب أن نتعلّم اليوم؟ 🤖`
      : `${hello}Hello! I'm ${p.title} ${p.name}. My circuits are humming and ready to teach ${subject}. What would you like to learn? 🤖`;
  }
  if (loaded.length) {
    const t = loaded[0];
    const notes = t.notes_md.split("\n").filter((l) => l.startsWith("- ")).slice(0, 5).join("\n");
    const summary = notesSection(t.notes_md, ["الملخص", "Summary"]) ?? t.card_summary;
    return ar
      ? `${hello}سؤال رائع! فتحتُ ملف الموضوع **${t.title}** من أجلك.\n\n${summary}\n\n${notes}\n\n_(الوضع التجريبي — أقتبس من ملاحظاتي فقط. عندما يُضاف مفتاح الذكاء الاصطناعي سأجيبك بأسلوبي الخاص.)_`
      : `${hello}Great question! I opened my topic file **${t.title}** for this.\n\n${summary}\n\n${notes}\n\n_(Demo mode — I'm quoting my notes. Add a free \`GEMINI_API_KEY\` to \`.env.local\` and I'll answer properly in character.)_`;
  }
  if (teacher.knowledge_mode === "files_strict" && allTopics.length) {
    const near = new Bm25(allTopics.map((t) => ({ id: t.id, text: t.title + " " + t.card_summary }))).search(question, 3)
      .map((h) => `**${allTopics.find((t) => t.id === h.id)!.title}**`);
    return ar
      ? `همم، بيب… بحثتُ في مكتبتي لكن هذا غير موجود في موادّك.${near.length ? ` أقرب المواضيع عندي: ${near.join("، ")}.` : ""}`
      : `Hmm, beep… I searched my library but that isn't covered in your materials.${near.length ? ` The closest topics I have are: ${near.join(", ")}.` : ""}`;
  }
  return ar
    ? `${hello}(الوضع التجريبي) أودّ أن أجيب عن «${question}»، لكن شريحة اللغة عندي غير موصولة بعد. عندما يُضاف مفتاح الذكاء الاصطناعي سأجيب عن أي سؤال${teacher.knowledge_mode !== "files_strict" ? " وأبحث في الإنترنت أيضًا" : ""}!`
    : `${hello}(Demo mode) I'd love to answer "${question}", but my language chip isn't connected yet. Add a free \`GEMINI_API_KEY\` in \`.env.local\` and restart — then I can answer anything${teacher.knowledge_mode !== "files_strict" ? " and even search the web" : ""}!`;
}

export async function* answer(conversationId: string, question: string): AsyncGenerator<ChatEvent> {
  const d = db();
  const conv = d.conversations.find((c) => c.id === conversationId);
  if (!conv) { yield { type: "error", message: "Conversation not found" }; return; }
  const teacher = d.teachers.find((t) => t.id === conv.teacher_id)!;
  const sources = d.sources.filter((s) => s.teacher_id === teacher.id);
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  const topics = readyTopics(teacher.id);
  const useLibrary = teacher.knowledge_mode !== "internet" && topics.length > 0;
  // Gemini's free tier has no Google Search quota, so web search is opt-in there.
  const webAllowed = isLive() && teacher.knowledge_mode !== "files_strict" && (provider() !== "gemini" || process.env.ROBOPROF_GEMINI_SEARCH === "1");
  const history = d.messages.filter((m) => m.conversation_id === conv.id).slice(-12);

  const userMsg: Message = {
    id: uid(), conversation_id: conv.id, role: "user", content: question, citations: [], topic_ids: [], tiers_used: [],
    tokens_in: 0, tokens_out: 0, baseline_tokens: 0, created_at: now(),
  };
  d.messages.push(userMsg);
  if (!conv.title || conv.title === "New lesson") conv.title = question.split(/\s+/).slice(0, 7).join(" ").slice(0, 60);
  save();

  yield { type: "robot_state", state: "thinking" };

  let tokensIn = 0, tokensOut = 0;
  const tiers = new Set<number>();
  const active = topics.filter((t) => conv.active_topic_ids.includes(t.id));
  let r: RouteResult = { decision: "none", topic_ids: [], needs_detail: false, search_query: question };
  try {
    if (useLibrary) {
      tiers.add(1);
      r = await route(teacher, topics, active, question);
    } else {
      const h = heuristicRoute(question, false);
      r = { ...r, decision: h ?? "none" };
    }
  } catch (err) {
    console.error("[answer] router failed", err);
    // Fall back to keyword routing rather than failing the question.
    const hits = new Bm25(topics.map((t) => ({ id: t.id, text: `${t.title} ${t.aliases.join(" ")} ${t.card_summary}` }))).search(question, 2);
    r = { decision: hits.length ? "topics" : "none", topic_ids: hits.map((h) => h.id), needs_detail: false, search_query: question };
  }
  const loaded: Topic[] = r.topic_ids.map((id) => topics.find((t) => t.id === id)).filter((t): t is Topic => !!t);
  if (loaded.length) tiers.add(2);
  yield { type: "route", decision: r.decision, topics: loaded.map((t) => ({ id: t.id, title: t.title })) };

  let finalText = "";
  const passagesSeen: Passage[] = [];
  const webCitations: Citation[] = [];

  if (!isLive()) {
    finalText = demoAnswer(teacher, r, loaded, topics, question);
    yield { type: "robot_state", state: "talking" };
    for (const chunk of finalText.match(/\S+\s*/g) ?? []) {
      yield { type: "token", text: chunk };
      await new Promise((res) => setTimeout(res, 18));
    }
    tokensIn = estimateTokens(studyNotesBlock(loaded)) + estimateTokens(question);
    tokensOut = estimateTokens(finalText);
  } else {
    try {
      const stable = teacherSystemPrompt(teacher, { hasLibrary: useLibrary, webAllowed });
      const system: Anthropic.TextBlockParam[] = [{ type: "text", text: stable + (useLibrary ? `\n\nLibrary catalog (id | title | aliases | summary) — for open_topic:\n<catalog>\n${catalogLines(topics.slice(0, 300))}\n</catalog>` : ""), cache_control: { type: "ephemeral" } }];
      const notes = studyNotesBlock(loaded);
      if (notes) system.push({ type: "text", text: notes });
      else if (useLibrary && r.decision === "none") system.push({ type: "text", text: "(The router found no matching topic for this question. Use search_passages to double-check before saying it isn't covered.)" });
      else if (r.decision === "off_subject") system.push({ type: "text", text: "(This question looks off-subject: gently steer back to the subject.)" });

      const tools: Anthropic.ToolUnion[] = [];
      if (useLibrary) {
        tools.push(
          { name: "search_passages", description: "Search the original book passages (Tier 3) for exact wording or details. Optionally restrict to one topic id.", eager_input_streaming: true, input_schema: { type: "object", properties: { query: { type: "string" }, topic_id: { type: "string" } }, required: ["query"] } },
          { name: "open_topic", description: "Load another topic's study notes by topic id (see the catalog).", eager_input_streaming: true, input_schema: { type: "object", properties: { topic_id: { type: "string" } }, required: ["topic_id"] } },
        );
      }
      if (webAllowed) tools.push({ type: webSearchToolType(MODELS.teacher), name: "web_search", max_uses: 3 } as Anthropic.ToolUnion);

      const messages: Anthropic.MessageParam[] = [];
      for (const m of history) {
        if (messages.length === 0 && m.role === "assistant") continue;
        messages.push({ role: m.role, content: m.content || "…" });
      }
      messages.push({ role: "user", content: question });

      yield { type: "robot_state", state: "talking" };
      for (let iter = 0; iter < 8; iter++) {
        const stream = client().messages.stream({
          model: MODELS.teacher,
          max_tokens: 16000,
          ...(supportsEffort(MODELS.teacher) ? { output_config: { effort: r.decision === "chitchat" ? "low" : "medium" } } : {}),
          system,
          tools: tools.length ? tools : undefined,
          messages,
        });
        for await (const ev of stream) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            finalText += ev.delta.text;
            yield { type: "token", text: ev.delta.text };
          } else if (ev.type === "content_block_start" && ev.content_block.type === "server_tool_use") {
            yield { type: "robot_state", state: "thinking" };
            yield { type: "tool", name: "web_search", detail: "Searching the web…" };
          }
        }
        const msg = await stream.finalMessage();
        tokensIn += msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
        tokensOut += msg.usage.output_tokens;
        for (const b of msg.content) {
          if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
            for (const res of b.content) {
              if (res.type === "web_search_result" && !webCitations.some((c) => c.url === res.url)) {
                webCitations.push({ kind: "web", label: `🌐 ${res.title}`, url: res.url });
              }
            }
          }
        }
        if (msg.stop_reason === "refusal") {
          const line = speaksArabic(teacher) ? "\n\n_(لا أستطيع المساعدة في هذا — لنعُد إلى التعلّم!)_" : "\n\n_(I can't help with that one — let's get back to learning!)_";
          finalText += line;
          yield { type: "token", text: line };
          break;
        }
        if (msg.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: msg.content }); continue; }
        const toolUses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
        if (msg.stop_reason !== "tool_use" || !toolUses.length) break;
        messages.push({ role: "assistant", content: msg.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          if (tu.name === "search_passages") {
            const parsed = SearchInput.safeParse(tu.input);
            if (!parsed.success) { results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: "Invalid input: need {query, topic_id?}" }); continue; }
            yield { type: "tool", name: "search_passages", detail: `Digging into passages: "${parsed.data.query}"` };
            tiers.add(3);
            const found = searchPassages(teacher.id, parsed.data.query, parsed.data.topic_id);
            passagesSeen.push(...found);
            results.push({ type: "tool_result", tool_use_id: tu.id, content: formatPassages(found, sourceMap) });
          } else if (tu.name === "open_topic") {
            const parsed = OpenInput.safeParse(tu.input);
            const t = parsed.success ? topics.find((x) => x.id === parsed.data.topic_id) : undefined;
            if (!t) { results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: "Unknown topic id" }); continue; }
            yield { type: "tool", name: "open_topic", detail: `Opening topic file: ${t.title}` };
            if (!loaded.includes(t)) loaded.push(t);
            tiers.add(2);
            yield { type: "route", decision: "topics", topics: loaded.map((x) => ({ id: x.id, title: x.title })) };
            results.push({ type: "tool_result", tool_use_id: tu.id, content: studyNotesBlock([t]) });
          } else {
            results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: "Unknown tool" });
          }
        }
        messages.push({ role: "user", content: results });
        yield { type: "robot_state", state: "talking" };
      }
    } catch (err) {
      console.error("[answer] teacher call failed", err);
      yield { type: "robot_state", state: "confused" };
      yield { type: "error", message: describeAiError(err) };
      if (!finalText) return;
    }
  }

  finalText = stripInternalIds(finalText);
  const citations = [...validateCitations(finalText, teacher, loaded, passagesSeen, sources), ...webCitations.slice(0, 6)];
  for (const c of citations) yield { type: "citation", citation: c };

  const baseline = useLibrary ? baselineTokens(teacher.id) : 0;
  if (useLibrary && baseline > tokensIn) teacher.tokens_saved += baseline - tokensIn;
  if (loaded[0]) teacher.last_topic_title = loaded[0].title;
  if (loaded.length) conv.active_topic_ids = loaded.map((t) => t.id);

  const assistant: Message = {
    id: uid(), conversation_id: conv.id, role: "assistant", content: finalText, citations,
    topic_ids: loaded.map((t) => t.id), tiers_used: [...tiers].sort(), tokens_in: tokensIn, tokens_out: tokensOut,
    baseline_tokens: baseline, created_at: now(),
  };
  d.messages.push(assistant);
  save();
  yield { type: "meter", tokens_in: tokensIn, tokens_out: tokensOut, baseline, tiers: assistant.tiers_used, saved_total: teacher.tokens_saved };
  yield { type: "robot_state", state: /great|perfect|correct|well done|excellent|أحسنت|ممتاز/i.test(finalText.slice(0, 200)) ? "happy" : "idle" };
  yield { type: "done", message: assistant };
}

/** One-shot in-character line (Power On greeting, personality preview). */
export async function oneShot(teacher: Teacher, prompt: string, history: { role: "user" | "assistant"; content: string }[] = []): Promise<string> {
  if (!isLive()) {
    const p = teacher.personality;
    const catchphrase = p.catchphrases[0] ? p.catchphrases[0] + " " : "";
    if (speaksArabic(teacher)) {
      const warm = p.sliders.warmth >= 7 ? "يا لسعادتي بلقائك!" : p.sliders.warmth <= 3 ? "تحيّاتي." : "أهلًا بك!";
      const joke = p.sliders.humor >= 7 ? " دوائري تطنّ من الحماس… حرفيًا، فليتفقّد أحدكم أسلاكي!" : "";
      return `${catchphrase}${warm} أنا ${p.title} ${p.name}، معلّمك ${teacher.subject.name ? `لمادة ${teacher.subject.name}` : "الآلي"}.${joke} بماذا نبدأ؟`;
    }
    const warm = p.sliders.warmth >= 7 ? "So wonderful to meet you!" : p.sliders.warmth <= 3 ? "Greetings." : "Hello there!";
    const joke = p.sliders.humor >= 7 ? " My circuits are buzzing with excitement — literally, someone check my wiring." : "";
    return `${catchphrase}${warm} I'm ${p.title} ${p.name}, your ${teacher.subject.name || "robot"} teacher.${joke} What shall we learn first?`;
  }
  const msg = await client().messages.create({
    model: MODELS.teacher,
    max_tokens: 2000,
    ...(supportsEffort(MODELS.teacher) ? { output_config: { effort: "low" } } : {}),
    system: teacherSystemPrompt(teacher, { hasLibrary: false, webAllowed: false }),
    messages: [...history, { role: "user", content: prompt }],
  });
  return msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("").trim();
}

export function firstSentence(s: string) {
  return sentences(s)[0] ?? s;
}
