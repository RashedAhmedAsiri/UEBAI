import "server-only";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * Google Gemini backend (free tier via Google AI Studio) behind the same `messages.create` /
 * `messages.stream` surface the app already uses, so callers don't change. Requests and
 * responses are translated between the Anthropic message shape and Gemini's generateContent.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export class GeminiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "GeminiError";
  }
}

interface Part {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; response: Record<string, unknown>; id?: string };
}
interface Content { role: "user" | "model"; parts: Part[] }
interface Chunk {
  candidates?: { content?: { parts?: Part[] }; finishReason?: string; groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] } }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

/** Blocks we hand back carry Gemini's thought signature (and call id) so they can be echoed next turn. */
type WithSig = { _sig?: string; _gid?: string };

type Params = Anthropic.MessageCreateParams;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function blocksText(c: string | { type: string; text?: string }[]): string {
  return typeof c === "string" ? c : c.map((b) => (b.type === "text" ? b.text ?? "" : "")).join("");
}

function toContents(messages: Anthropic.MessageParam[]): Content[] {
  const toolNames = new Map<string, string>();
  const geminiIds = new Map<string, string>();
  const out: Content[] = [];
  for (const m of messages) {
    const role = m.role === "assistant" ? "model" : "user";
    const parts: Part[] = [];
    if (typeof m.content === "string") parts.push({ text: m.content });
    else {
      for (const b of m.content) {
        const sig = (b as WithSig)._sig ? { thoughtSignature: (b as WithSig)._sig } : {};
        if (b.type === "text") parts.push({ text: b.text, ...sig });
        else if ((b.type === "image" || b.type === "document") && b.source.type === "base64") {
          parts.push({ inlineData: { mimeType: b.source.media_type, data: b.source.data } });
        } else if (b.type === "document" && b.source.type === "text") parts.push({ text: b.source.data });
        else if (b.type === "tool_use") {
          const gid = (b as WithSig)._gid;
          toolNames.set(b.id, b.name);
          if (gid) geminiIds.set(b.id, gid);
          parts.push({ functionCall: { name: b.name, args: (b.input ?? {}) as Record<string, unknown>, ...(gid ? { id: gid } : {}) }, ...sig });
        } else if (b.type === "tool_result") {
          const text = b.content === undefined ? "" : blocksText(b.content as string | { type: string; text?: string }[]);
          const gid = geminiIds.get(b.tool_use_id);
          parts.push({ functionResponse: { name: toolNames.get(b.tool_use_id) ?? "tool", response: b.is_error ? { error: text } : { result: text }, ...(gid ? { id: gid } : {}) } });
        }
        // Server-tool blocks (web search results) are Anthropic-only; Gemini grounding needs no replay.
      }
    }
    if (!parts.length) continue;
    const last = out[out.length - 1];
    if (last?.role === role) last.parts.push(...parts);
    else out.push({ role, parts });
  }
  return out;
}

function toRequest(p: Params) {
  const system = typeof p.system === "string" ? p.system : (p.system ?? []).map((b) => b.text).join("\n\n");
  const decls: { name: string; description?: string; parameters: unknown }[] = [];
  let search = false;
  for (const t of p.tools ?? []) {
    if ("input_schema" in t) decls.push({ name: t.name, description: t.description, parameters: t.input_schema });
    else if ("type" in t && String(t.type).startsWith("web_search")) search = true;
  }
  // Library tools take priority; Google Search is used when the teacher has no library tools.
  const tools = decls.length ? [{ functionDeclarations: decls }] : search ? [{ googleSearch: {} }] : undefined;
  return {
    contents: toContents(p.messages),
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    ...(tools ? { tools } : {}),
    generationConfig: {
      // Thinking tokens count against this cap, so small Anthropic-sized budgets get headroom.
      maxOutputTokens: Math.max(p.max_tokens, 8192),
      // Default thinking makes replies start ~30s late; "low" is plenty for teaching and JSON jobs.
      thinkingConfig: { thinkingLevel: /high|max/.test(String(p.output_config?.effort)) ? "high" : "low" },
    },
  };
}

// Free-tier quotas are per model per minute (e.g. 15 RPM on flash-lite); stay under them client-side.
const RPM = Number(process.env.ROBOPROF_GEMINI_RPM) || 10;

// Quota bookkeeping lives on globalThis so dev reloads don't forget it (functions are never cached there).
type QuotaState = { recent: Map<string, number[]>; exhausted: Map<string, number>; overloaded: Map<string, number> };
const qg = globalThis as typeof globalThis & { __roboprofGeminiQuota?: QuotaState };
const quota: QuotaState = (qg.__roboprofGeminiQuota ??= { recent: new Map(), exhausted: new Map(), overloaded: new Map() });
const recent = quota.recent;

async function slot(model: string) {
  for (;;) {
    const now = Date.now();
    const list = (recent.get(model) ?? []).filter((t) => now - t < 60_000);
    recent.set(model, list);
    if (list.length < RPM) { list.push(now); return; }
    await sleep(60_000 - (now - list[0]) + 100);
  }
}

/** Google's suggested wait, from `retryDelay: "14s"` or "Please retry in 14.6s". */
function retryAfterMs(raw: string): number | undefined {
  const m = raw.match(/"retryDelay"\s*:\s*"([\d.]+)s"/) ?? raw.match(/retry in ([\d.]+)s/i);
  return m ? Math.ceil(Number(m[1]) * 1000) : undefined;
}

// Every free model has its own daily quota (gemini-3.8-flash: 20/day). When one runs out or is
// overloaded, move down its chain. Flash models end in the lite chain; lite models never borrow
// flash quota, so background book work can't eat the teacher's better models.
const FLASH_CHAIN = ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"];
const LITE_CHAIN = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
const exhaustedAt = quota.exhausted;
const RECHECK_MS = 60 * 60_000;
// Free-tier models are often briefly overloaded (503); skip one for a bit instead of waiting on it.
const overloadedAt = quota.overloaded;
const OVERLOAD_SKIP_MS = 2 * 60_000;

function chainFor(model: string): string[] {
  const i = FLASH_CHAIN.indexOf(model);
  if (i >= 0) return [...FLASH_CHAIN.slice(i), ...LITE_CHAIN];
  const j = LITE_CHAIN.indexOf(model);
  if (j >= 0) return LITE_CHAIN.slice(j);
  return [model, ...LITE_CHAIN];
}

async function post(requested: string, method: string, body: unknown): Promise<Response> {
  const key = process.env.GEMINI_API_KEY ?? "";
  const full = chainFor(requested);
  const now = Date.now();
  const usable = full.filter((m) => now - (exhaustedAt.get(m) ?? 0) >= RECHECK_MS);
  const idle = usable.filter((m) => now - (overloadedAt.get(m) ?? 0) >= OVERLOAD_SKIP_MS);
  const chain = idle.length ? idle : usable.length ? usable : [full[full.length - 1]];
  let idx = 0;
  let model = chain[0];
  let serverErrors = 0;
  const nextModel = (why: string) => {
    if (idx + 1 >= chain.length) return false;
    console.warn(`[gemini] ${model} ${why} → switching to ${chain[idx + 1]}`);
    model = chain[++idx];
    serverErrors = 0;
    return true;
  };
  for (let attempt = 0; ; attempt++) {
    await slot(model);
    let res: Response;
    try {
      res = await fetch(`${BASE}/${encodeURIComponent(model)}:${method}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
      throw new GeminiError(0, String(err));
    }
    if (res.ok) return res;
    const raw = await res.text();
    let message = raw;
    try { message = (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? raw; } catch { /* not JSON */ }
    const daily = res.status === 429 && /per ?day/i.test(raw);
    if (daily) {
      exhaustedAt.set(model, Date.now());
      if (nextModel("used up its free daily quota")) continue;
      throw new GeminiError(429, `daily: ${message}`);
    }
    if (res.status === 429) {
      // Per-minute limits clear within a minute.
      const wait = retryAfterMs(raw) ?? 20_000;
      if (attempt < 5 && wait <= 90_000) { await sleep(wait + 500); continue; }
    } else if (res.status >= 500) {
      overloadedAt.set(model, Date.now());
      if (nextModel(`is busy (${res.status})`)) continue;
      if (++serverErrors <= 2) { await sleep(2000 * serverErrors); continue; }
    } else if (res.status === 404 && nextModel("is not available (404)")) continue;
    throw new GeminiError(res.status, message);
  }
}

class Accumulator {
  private blocks: (Anthropic.ContentBlock & WithSig)[] = [];
  private finish?: string;
  private blocked = false;
  private usage = { input: 0, output: 0 };
  private web = new Map<string, string>();

  constructor(private model: string) {}

  /** Folds one response chunk in; returns the new visible text. */
  add(chunk: Chunk): string {
    if (chunk.promptFeedback?.blockReason) this.blocked = true;
    const cand = chunk.candidates?.[0];
    let delta = "";
    for (const part of cand?.content?.parts ?? []) {
      if (part.thought) continue;
      if (part.functionCall) {
        this.blocks.push({
          type: "tool_use", id: part.functionCall.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
          name: part.functionCall.name, input: part.functionCall.args ?? {}, _sig: part.thoughtSignature, _gid: part.functionCall.id,
        } as Anthropic.ToolUseBlock & WithSig);
        continue;
      }
      let last = this.blocks[this.blocks.length - 1];
      if (typeof part.text === "string" || part.thoughtSignature) {
        if (last?.type !== "text") {
          last = { type: "text", text: "", citations: null } as Anthropic.TextBlock & WithSig;
          this.blocks.push(last);
        }
        if (part.text) { (last as Anthropic.TextBlock).text += part.text; delta += part.text; }
        if (part.thoughtSignature) last._sig = part.thoughtSignature;
      }
    }
    if (cand?.finishReason) this.finish = cand.finishReason;
    for (const g of cand?.groundingMetadata?.groundingChunks ?? []) if (g.web?.uri) this.web.set(g.web.uri, g.web.title ?? g.web.uri);
    const u = chunk.usageMetadata;
    if (u) this.usage = { input: u.promptTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) };
    return delta;
  }

  /** Gemini sometimes ends a turn with no text and no call (often right after a tool result). */
  isEmpty(): boolean {
    return !this.blocked && !this.blocks.some((b) => b.type === "tool_use" || (b.type === "text" && b.text.trim()));
  }

  get finishReason() { return this.finish; }

  message(): Anthropic.Message {
    const content: unknown[] = this.blocks.filter((b) => b.type !== "text" || b.text || b._sig);
    if (this.web.size) {
      content.push({
        type: "web_search_tool_result", tool_use_id: "google_search",
        content: [...this.web].map(([url, title]) => ({ type: "web_search_result", url, title, encrypted_content: "", page_age: null })),
      });
    }
    const refused = this.blocked || ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"].includes(this.finish ?? "");
    const stop_reason = refused ? "refusal"
      : this.blocks.some((b) => b.type === "tool_use") ? "tool_use"
      : this.finish === "MAX_TOKENS" ? "max_tokens" : "end_turn";
    return {
      id: `gemini_${Date.now()}`, type: "message", role: "assistant", model: this.model, content, stop_reason, stop_sequence: null,
      usage: { input_tokens: this.usage.input, output_tokens: this.usage.output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    } as unknown as Anthropic.Message;
  }
}

async function create(p: Params): Promise<Anthropic.Message> {
  for (let attempt = 0; ; attempt++) {
    const res = await post(p.model, "generateContent", toRequest(p));
    const acc = new Accumulator(p.model);
    acc.add((await res.json()) as Chunk);
    if (acc.isEmpty() && attempt < 2) { console.warn(`[gemini] empty reply (finish=${acc.finishReason}) — asking again`); continue; }
    return acc.message();
  }
}

function stream(p: Params) {
  let acc = new Accumulator(p.model);
  let started = false;
  let draining = false;
  let resolveFinal!: (m: Anthropic.Message) => void;
  let rejectFinal!: (e: unknown) => void;
  const final = new Promise<Anthropic.Message>((res, rej) => { resolveFinal = res; rejectFinal = rej; });
  final.catch(() => {});

  async function* run(): AsyncGenerator<Anthropic.MessageStreamEvent> {
    started = true;
    try {
      for (let attempt = 0; ; attempt++) {
        acc = new Accumulator(p.model);
        let yielded = false;
        try {
          const res = await post(p.model, "streamGenerateContent?alt=sse", toRequest(p));
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (value) buf += decoder.decode(value, { stream: true });
            const lines = buf.split(/\r?\n/);
            buf = done ? "" : lines.pop() ?? "";
            for (const line of lines) {
              if (!line.startsWith("data:")) continue;
              const text = acc.add(JSON.parse(line.slice(5)) as Chunk);
              if (text) {
                yielded = true;
                yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } as Anthropic.MessageStreamEvent;
              }
            }
            if (done) break;
          }
          if (acc.isEmpty() && attempt < 2) { console.warn(`[gemini] empty reply (finish=${acc.finishReason}) — asking again`); continue; }
          break;
        } catch (err) {
          // Connection dropped mid-stream (ECONNRESET): start over, unless a live reader already saw text.
          if (err instanceof GeminiError || attempt >= 2 || (yielded && !draining)) throw err;
          await sleep(1500 * (attempt + 1));
        }
      }
      resolveFinal(acc.message());
    } catch (err) {
      rejectFinal(err);
      throw err;
    }
  }

  return {
    [Symbol.asyncIterator]: () => run(),
    async finalMessage() {
      if (!started) { draining = true; for await (const _ of run()) { /* drain */ } }
      return final;
    },
  };
}

export function geminiClient(): Anthropic {
  return { messages: { create, stream } } as unknown as Anthropic;
}
