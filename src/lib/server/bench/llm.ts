import "server-only";
import { BenchError, deepseekError, geminiError } from "@/lib/bench/errors";

export { BenchError };

/**
 * Strict model calls for the benchmark. Unlike the app's adapter (src/lib/ai/gemini.ts), this
 * never falls back to another model, never waits for a rate-limit slot inside the timed region,
 * and reports the model version the API says actually answered. One call = one measurement.
 *
 * Models: any Gemini API model id ("gemini-3.6-flash", "gemma-4-26b-a4b-it", …) or a local
 * Ollama model as "ollama:<name>" (e.g. "ollama:qwen3:4b") for offline small-model tests.
 */

export interface LlmResult {
  text: string;
  /** Time to the first answer token (thinking excluded), from sending the request. */
  ttft_ms: number | null;
  /** Until the last token arrived. */
  total_ms: number;
  input_tokens: number | null;
  cached_tokens: number | null;
  output_tokens: number | null;
  thought_tokens: number | null;
  model_version: string;
  finish_reason: string | null;
  truncated?: boolean;
}

export interface CallOptions {
  maxOutput: number;
  thinking: "low" | "high";
  /** Ollama context window. */
  numCtx: number;
  /** Rough prompt size, used to tell "over the per-minute token limit forever" from "wait a bit". */
  promptTokensEst: number;
  json?: boolean;
  timeoutMs?: number;
}

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models";

export function callModel(model: string, system: string, user: string, opts: CallOptions): Promise<LlmResult> {
  if (model.startsWith("ollama:")) return ollama(model.slice(7), system, user, opts);
  if (model.startsWith("deepseek")) return deepseek(model, system, user, opts);
  return gemini(model, system, user, opts);
}

/** DeepSeek API (OpenAI-style chat completions, streamed). Models: deepseek-flash, deepseek-v4-pro. */
async function deepseek(model: string, system: string, user: string, opts: CallOptions): Promise<LlmResult> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new BenchError("DEEPSEEK_API_KEY is not set", "other");
  const base = (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 600_000);
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        stream: true,
        stream_options: { include_usage: true },
        max_tokens: opts.maxOutput,
        thinking: { type: "enabled", reasoning_effort: opts.thinking },
        // No JSON mode here: the judge prompt asks for JSON and the reply is parsed from text.
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw new BenchError(`Network error: ${(e as Error).message}`, "network", 5000);
  }
  if (!res.ok || !res.body) {
    clearTimeout(timer);
    throw deepseekError(res.status, await res.text().catch(() => ""));
  }
  let text = "", ttft: number | null = null, version = model, finish: string | null = null;
  let usage: { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } } = {};
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        const j = JSON.parse(data) as { model?: string; usage?: typeof usage; error?: { message?: string }; choices?: { finish_reason?: string | null; delta?: { content?: string | null } }[] };
        if (j.error) throw new BenchError(j.error.message ?? "DeepSeek stream error", "network", 10_000);
        if (j.model) version = j.model;
        if (j.usage) usage = j.usage;
        const ch = j.choices?.[0];
        if (ch?.finish_reason) finish = ch.finish_reason;
        // reasoning_content (thinking) is skipped: the student waits for the answer text.
        const piece = ch?.delta?.content ?? "";
        if (piece) { if (ttft === null && piece.trim()) ttft = performance.now() - t0; text += piece; }
      }
    }
  } catch (e) {
    if (e instanceof BenchError) throw e;
    throw new BenchError(`Stream broke: ${(e as Error).message}`, "network", 5000);
  } finally {
    clearTimeout(timer);
  }
  if (!text.trim()) throw new BenchError(`Empty answer (finish reason: ${finish ?? "unknown"})`, "other");
  const reasoning = usage.completion_tokens_details?.reasoning_tokens ?? 0;
  return {
    text, ttft_ms: ttft, total_ms: performance.now() - t0,
    input_tokens: usage.prompt_tokens ?? null,
    cached_tokens: usage.prompt_cache_hit_tokens ?? 0,
    // completion_tokens includes the thinking tokens; keep them apart so cost isn't counted twice.
    output_tokens: usage.completion_tokens !== undefined ? usage.completion_tokens - reasoning : null,
    thought_tokens: reasoning,
    model_version: version, finish_reason: finish,
  };
}

/**
 * Exact prompt size from Google's official token counter. countTokens is free and has its own,
 * much larger limits, so it doesn't use the daily answer quota.
 */
export async function countTokens(model: string, system: string, user: string): Promise<number> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new BenchError("GEMINI_API_KEY is not set", "other");
  const res = await fetch(`${GEMINI}/${encodeURIComponent(model)}:countTokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `${system}\n\n${user}` }] }] }),
  });
  if (!res.ok) throw geminiError(res.status, await res.text().catch(() => ""), 0);
  return ((await res.json()) as { totalTokens?: number }).totalTokens ?? 0;
}

function thinkingConfig(model: string, level: "low" | "high") {
  if (/^gemma/.test(model)) return undefined;
  if (/^gemini-2\./.test(model)) return { thinkingBudget: level === "high" ? 8192 : /lite/.test(model) ? 0 : 1024 };
  return { thinkingLevel: level };
}

async function gemini(model: string, system: string, user: string, opts: CallOptions): Promise<LlmResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new BenchError("GEMINI_API_KEY is not set", "other");
  // Gemma on the Gemini API has no system instruction: put it in front of the user turn instead.
  const gemma = /^gemma/.test(model);
  const body = {
    ...(gemma ? {} : { systemInstruction: { parts: [{ text: system }] } }),
    contents: [{ role: "user", parts: [{ text: gemma ? `${system}\n\n${user}` : user }] }],
    generationConfig: {
      maxOutputTokens: opts.maxOutput,
      ...(thinkingConfig(model, opts.thinking) ? { thinkingConfig: thinkingConfig(model, opts.thinking) } : {}),
      ...(opts.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 300_000);
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(`${GEMINI}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw new BenchError(`Network error: ${(e as Error).message}`, "network", 5000);
  }
  if (!res.ok) {
    clearTimeout(timer);
    throw geminiError(res.status, await res.text().catch(() => ""), opts.promptTokensEst);
  }

  let text = "", ttft: number | null = null, version = model, finish: string | null = null;
  let usage: { promptTokenCount?: number; cachedContentTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } = {};
  try {
    for await (const chunk of sseJson(res)) {
      if (chunk.error) throw geminiError(chunk.error.code ?? 500, JSON.stringify(chunk), opts.promptTokensEst);
      if (chunk.modelVersion) version = chunk.modelVersion;
      if (chunk.usageMetadata) usage = chunk.usageMetadata;
      const cand = chunk.candidates?.[0];
      if (cand?.finishReason) finish = cand.finishReason;
      for (const part of cand?.content?.parts ?? []) {
        if (part.thought || typeof part.text !== "string") continue;
        if (ttft === null && part.text.trim()) ttft = performance.now() - t0;
        text += part.text;
      }
    }
  } catch (e) {
    if (e instanceof BenchError) throw e;
    throw new BenchError(`Stream broke: ${(e as Error).message}`, "network", 5000);
  } finally {
    clearTimeout(timer);
  }
  const total = performance.now() - t0;
  if (!text.trim()) throw new BenchError(`Empty answer (finish reason: ${finish ?? "unknown"})`, "other");
  return {
    text, ttft_ms: ttft, total_ms: total,
    input_tokens: usage.promptTokenCount ?? null,
    cached_tokens: usage.cachedContentTokenCount ?? 0,
    output_tokens: usage.candidatesTokenCount ?? null,
    thought_tokens: usage.thoughtsTokenCount ?? 0,
    model_version: version, finish_reason: finish,
  };
}

interface GeminiChunk {
  error?: { code?: number; message?: string };
  modelVersion?: string;
  usageMetadata?: { promptTokenCount?: number; cachedContentTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  candidates?: { finishReason?: string; content?: { parts?: { text?: string; thought?: boolean }[] } }[];
}

async function* sseJson(res: Response): AsyncGenerator<GeminiChunk> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line.startsWith("data:")) yield JSON.parse(line.slice(5).trim()) as GeminiChunk;
    }
  }
  const rest = buf.trim();
  if (rest.startsWith("data:")) yield JSON.parse(rest.slice(5).trim()) as GeminiChunk;
}

async function ollama(model: string, system: string, user: string, opts: CallOptions): Promise<LlmResult> {
  const base = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 600_000);
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model, stream: true, think: opts.thinking === "high",
        ...(opts.json ? { format: "json" } : {}),
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        options: { num_ctx: opts.numCtx, num_predict: opts.maxOutput },
      }),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw new BenchError(`Ollama is not reachable at ${base} (${(e as Error).message})`, "network", 5000);
  }
  if (!res.ok || !res.body) {
    clearTimeout(timer);
    throw new BenchError(`Ollama: ${await res.text().catch(() => res.status)}`, "other");
  }
  let text = "", ttft: number | null = null, promptTokens: number | null = null, outTokens: number | null = null, finish: string | null = null;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const j = JSON.parse(line) as { message?: { content?: string }; done?: boolean; done_reason?: string; prompt_eval_count?: number; eval_count?: number; error?: string };
        if (j.error) throw new BenchError(`Ollama: ${j.error}`, "other");
        const piece = j.message?.content ?? "";
        if (piece) { if (ttft === null && piece.trim()) ttft = performance.now() - t0; text += piece; }
        if (j.done) { promptTokens = j.prompt_eval_count ?? null; outTokens = j.eval_count ?? null; finish = j.done_reason ?? null; }
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return {
    text, ttft_ms: ttft, total_ms: performance.now() - t0,
    input_tokens: promptTokens, cached_tokens: 0, output_tokens: outTokens, thought_tokens: 0,
    model_version: `ollama:${model}`, finish_reason: finish,
    // Ollama keeps only the last num_ctx tokens of a long prompt, silently.
    truncated: promptTokens !== null && promptTokens >= opts.numCtx - 8 && opts.promptTokensEst > opts.numCtx,
  };
}
