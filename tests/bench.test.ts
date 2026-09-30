import { describe, expect, it } from "vitest";
import { abstained, citedPages, factRecall, gradeAnswer, matchFacts, normalizeAnswer, pageHit, repeatedShare } from "@/lib/bench/grade";
import { breakEven, ci95, hashSeed, mean, median, priceFor, rng, shuffle, signFlipP, summarize } from "@/lib/bench/stats";
import { deepseekError, geminiError, limitFromMessage } from "@/lib/bench/errors";
import { modelLimit, splitByPages } from "@/lib/bench/parts";
import { repairPdfArabic } from "@/lib/text";
import { pruneOrphanTopics } from "@/lib/ingest/prune";
import type { BenchCall, BenchRun } from "@/lib/bench/types";

describe("answer grading", () => {
  it("normalizes Arabic letter forms, diacritics and digits", () => {
    expect(normalizeAnswer("الأَنُوفِيلِس")).toBe("الانوفيلس");
    expect(normalizeAnswer("٩٠٫٢٪")).toBe("90.2%");
    expect(normalizeAnswer("٢٠٠٬٠٠٠ دياتومة")).toBe("200000 دياتومه");
    expect(normalizeAnswer("ﻗــﺎرن")).toBe("قارن"); // PDF presentation forms
  });

  it("matches key facts with alternatives and PDF-broken lam-alef spellings", () => {
    const answer = "يسببه طفيل البالزموديوم، وتنقله أنثى بعوضة الأنوفيلس [ص 99].";
    expect(matchFacts(answer, ["البلازموديوم", "الانوفيلس|انوفيلس", "القشعريره"])).toEqual([true, true, false]);
    expect(factRecall(answer, ["البلازموديوم", "القشعريره"])).toBe(0.5);
    expect(factRecall(answer, [])).toBeNull();
  });

  it("finds cited pages in Arabic and English styles", () => {
    expect(citedPages("كما في [ص 70] و[ص ٩٨-٩٩] وص.12 and [p.7]")).toEqual([7, 12, 70, 98, 99]);
    expect(pageHit([98], [99])).toBe(true);
    expect(pageHit([50], [99])).toBe(false);
    expect(pageHit([50], [])).toBeNull();
  });

  it("detects 'not in the book' only when the material is mentioned", () => {
    expect(abstained("غير موجود في الكتاب.")).toBe(true);
    expect(abstained("لم يرد ذكر ذلك في المادة المرجعية.")).toBe(true);
    expect(abstained("ليس للديدان المفلطحة أعضاء متخصصة للتنفس، ولا توجد رئتان.")).toBe(false);
  });

  it("scores unanswerable questions by abstention", () => {
    const q = { facts: [], pages: [], category: "unanswerable" };
    expect(gradeAnswer("غير موجود في الكتاب.", q).correct_abstention).toBe(true);
    expect(gradeAnswer("يوجد ٤٦ كروموسومًا.", q).correct_abstention).toBe(false);
  });
});

describe("statistics", () => {
  it("computes basic summaries", () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(median([5, 1, 3, 2])).toBe(2.5);
    const [lo, hi] = ci95([10, 12, 14]);
    expect(lo).toBeLessThan(12);
    expect(hi).toBeGreaterThan(12);
  });

  it("sign-flip test is exact for small n", () => {
    // All 5 differences positive: only the all-plus and all-minus flips are as extreme → 2/32.
    expect(signFlipP([1, 2, 3, 4, 5])).toBeCloseTo(2 / 32, 10);
    expect(signFlipP([0, 0, 0])).toBe(1);
    expect(signFlipP([1, -1])).toBe(1);
  });

  it("shuffles reproducibly", () => {
    const a = shuffle([1, 2, 3, 4, 5, 6], rng(hashSeed("x")));
    const b = shuffle([1, 2, 3, 4, 5, 6], rng(hashSeed("x")));
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("break-even point", () => {
    expect(breakEven(300_000, 195_000, 3_000)).toBe(2);
    expect(breakEven(300_000, 3_000, 3_000)).toBeNull();
  });

  it("summarizes a run with paired comparisons", () => {
    const call = (q: string, condition: "full" | "uebai", total: number, input: number, recall: number): BenchCall => ({
      id: `${q}-${condition}`, question_id: q, model: "m", condition, rep: 1, status: "ok", prep_ms: 0, ttft_ms: total / 2, total_ms: total,
      context_tokens_est: input, context_chars: 0, input_tokens: input, cached_tokens: 0, output_tokens: 100, thought_tokens: 0,
      answer: "", recall, cited_pages: [], page_hit: true, abstained: false, correct_abstention: null, started_at: "",
    });
    const qs = ["a", "b", "c", "d", "e", "f"];
    const run = {
      id: "r", created_at: "", updated_at: "", status: "done", message: "",
      config: { teacher_id: "t", dataset: "d.json", question_ids: qs, models: ["m"], conditions: ["full", "uebai"], reps: 1, judge_model: null, small_window: 8192, thinking: "low", max_output_tokens: 1000, rpm: 5, tpm: 1e6, price_in: 0.5, price_out: 3, seed: 1 },
      dataset: { name: "d", questions: qs.map((id) => ({ id, q: id, category: "fact", answer: "", facts: ["x"], pages: [1] })) },
      book: { source_ids: [], labels: [], pages: 1, full_tokens_est: 100_000, topics: 1, cards_tokens: 1000, passages: 1 },
      plan: [], judgments: [], ratings: [],
      calls: qs.flatMap((q) => [call(q, "full", 40_000, 190_000, 1), call(q, "uebai", 5_000, 3_000, 0.85)]),
    } as BenchRun;
    const s = summarize(run);
    const speed = s.comparisons.find((c) => c.metric === "total_ms")!;
    expect(speed.ratio_median).toBe(8);
    expect(speed.wins).toBe(6);
    expect(speed.p).toBeCloseTo(2 / 64, 10);
    // 15 points lower on every question is past the 10-point margin: not "not worse".
    expect(s.comparisons.find((c) => c.metric === "recall")!.non_inferior).toBe(false);
    expect(speed.non_inferior).toBeNull();
    const ue = s.cells.find((c) => c.condition === "uebai")!;
    expect(ue.recall.mean).toBeCloseTo(0.85);
    expect(ue.cost_per_1000).toBeCloseTo(((3000 * 0.5 + 100 * 3) / 1e6) * 1000);
  });
});

describe("Gemini error classification", () => {
  const body = (quotaId: string, extra: Record<string, unknown> = {}) => JSON.stringify({
    error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "quota", details: [
      { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId, quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_input_token_count", ...extra }] },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "37s" },
    ] },
  });
  it("tells daily quota, per-minute limits and impossible prompts apart", () => {
    expect(geminiError(429, body("GenerateRequestsPerDayPerProjectPerModel-FreeTier"), 1000).kind).toBe("quota_day");
    const minute = geminiError(429, body("GenerateContentInputTokensPerModelPerMinute-FreeTier", { quotaValue: "250000" }), 1000);
    expect(minute.kind).toBe("quota_minute");
    expect(minute.retryAfterMs).toBe(37_000);
    expect(geminiError(429, body("GenerateContentInputTokensPerModelPerMinute-FreeTier", { quotaValue: "15000" }), 190_000).kind).toBe("too_large");
    expect(geminiError(503, "{}", 1000).kind).toBe("network");
  });
});

describe("DeepSeek + whole book in parts", () => {
  it("classifies DeepSeek errors", () => {
    expect(deepseekError(400, JSON.stringify({ error: { message: "This model's maximum context length is 131072 tokens." } })).kind).toBe("too_large");
    expect(deepseekError(402, "{}").kind).toBe("quota_day");
    expect(deepseekError(429, "{}").kind).toBe("quota_minute");
    expect(deepseekError(503, "{}").kind).toBe("network");
    expect(limitFromMessage("This model's maximum context length is 131072 tokens.")).toBe(131072);
    expect(limitFromMessage("Prompt (~155798 tokens) is over this model's per-minute token limit (16000).")).toBe(16000);
  });

  it("splits the book between pages and never loses text", () => {
    const pages = Array.from({ length: 30 }, (_, i) => `[ص ${i + 1}]\n${"كلمة ".repeat(200)}`);
    const text = pages.join("\n\n");
    const parts = splitByPages(text, 1500);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.startsWith("[ص"))).toBe(true);
    expect(parts.join("\n\n")).toBe(text);
    expect(modelLimit("deepseek-flash", 8192)).toBe(1_000_000);
    expect(modelLimit("ollama:qwen3:4b", 8192)).toBe(8192);
  });

  it("prices DeepSeek at its list price and other models at the run's assumption", () => {
    const cfg = { price_in: 0.5, price_cached: 0.05, price_out: 3 };
    expect(priceFor("deepseek-flash", cfg)).toEqual({ in: 0.3, cached: 0.006, out: 1.2 });
    expect(priceFor("gemini-3.6-flash", cfg)).toEqual({ in: 0.5, cached: 0.05, out: 3 });
  });
});

describe("repeated wording", () => {
  it("is zero for plain text and grows when a passage is repeated", () => {
    const a = "تنقل أنثى بعوضة الأنوفيلس طفيل البلازموديوم الذي يسبب مرض الملاريا للإنسان في المناطق الاستوائية الحارة";
    const b = "تعيش البدائيات المحبة للملوحة في البحيرات المالحة والبحر الميت حيث يزيد تركيز الملح كثيرًا عن المحيطات";
    expect(repeatedShare(`${a} ${b}`)).toBe(0);
    const twice = repeatedShare(`${a} [ص 99] ${b} [الشرائح ص 12] ${a}`);
    expect(twice).toBeGreaterThan(0.2); // one of three sentences repeated ≈ a quarter of the text
    expect(twice).toBeLessThan(0.5);
  });
});

describe("orphan topic cleanup", () => {
  it("removes only never-built topics whose paragraphs are gone", () => {
    const topic = (id: string, paragraph_ids: string[], notes_md: string, unit_id: string) =>
      ({ id, teacher_id: "t", unit_id, parent_topic_id: null, title: id, aliases: [], keywords: [], card_summary: "", notes_md, notes_tokens: 0, notes_user_edited: false, paragraph_ids, source_refs: [], dirty: !notes_md, version: 0, created_at: "", updated_at: "" });
    const d = {
      teachers: [], sources: [], jobs: [], messages: [], merge_log: [],
      units: [{ id: "u1", teacher_id: "t", title: "A", order_index: 0 }, { id: "u2", teacher_id: "t", title: "B", order_index: 1 }],
      paragraphs: [{ id: "p1", teacher_id: "t", source_id: "s", idx: 1, page: 1, text: "x", norm_hash: "h", heading: null }],
      topics: [topic("keep-notes", ["gone"], "notes", "u1"), topic("keep-live", ["p1"], "", "u1"), topic("orphan", ["gone"], "", "u2")],
      passages: [{ id: "x", teacher_id: "t", topic_id: "orphan", source_id: "s", page_start: 1, page_end: 1, text: "", tokens: 0 }],
      topic_links: [{ topic_a: "orphan", topic_b: "keep-live", kind: "related" as const }],
      conversations: [{ id: "c", teacher_id: "t", title: "", active_topic_ids: ["orphan", "keep-live"], created_at: "" }],
    };
    expect(pruneOrphanTopics(d)).toBe(1);
    expect(d.topics.map((t) => t.id)).toEqual(["keep-notes", "keep-live"]);
    expect(d.passages).toEqual([]);
    expect(d.topic_links).toEqual([]);
    expect(d.units.map((u) => u.id)).toEqual(["u1"]);
    expect(d.conversations[0].active_topic_ids).toEqual(["keep-live"]);
  });
});

describe("PDF Arabic repair", () => {
  it("fixes presentation forms and impossible reversed lam-alef sequences only", () => {
    expect(repairPdfArabic("ﻗــﺎرن اﻻﺳــﺘﺮاﺗﻴﺠﻴﺎت")).toBe("قــارن الاســتراتيجيات");
    expect(repairPdfArabic("األرض واإلنسان واالنتشار")).toBe("الأرض والإنسان والانتشار");
    expect(repairPdfArabic("ال يوجد إال واحد")).toBe("ال يوجد إلا واحد");
    // Valid words are never touched.
    expect(repairPdfArabic("الأرض خالية والمال")).toBe("الأرض خالية والمال");
  });
});
