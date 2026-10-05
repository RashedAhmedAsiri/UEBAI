import { fail, getTeacher, json } from "@/lib/server/teachers";
import { ITEMS, THEME_PACKS, matchThemePack, sanitizeWardrobe, wardrobeFromIds } from "@/lib/catalog";
import { completeJson, isLive, describeAiError } from "@/lib/ai/provider";
import { outfitPrompt } from "@/lib/ai/prompts";
import { syncDb } from "@/lib/server/db";

export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/** "Dress for my subject": theme pack if one matches, otherwise the small model picks catalog IDs only. */
export async function POST(req: Request, { params }: Ctx) {
  await syncDb();
  const t = getTeacher((await params).id);
  if (!t) return fail("Teacher not found", 404);
  const body = (await req.json().catch(() => ({}))) as { subject?: string };
  const subject = (body.subject ?? t.subject.name).trim();
  if (!subject) return fail("Pick a subject first (Subject Desk), or type one.");

  const pack = matchThemePack(subject);
  if (pack) return json({ source: "theme_pack", pack, wardrobe: sanitizeWardrobe(THEME_PACKS[pack].outfit) });

  if (!isLive()) {
    // Offline: pick items whose subject tags or names overlap the subject words.
    const words = subject.toLowerCase().split(/\s+/);
    const ids = ITEMS.filter((i) => words.some((w) => i.name.en.toLowerCase().includes(w) || i.subjects.some((s) => s.includes(w)))).map((i) => i.id);
    const fallback = ids.length ? ids : ["tweed_jacket", "round_glasses", "book", "book_stack"];
    return json({ source: "offline", pack: null, wardrobe: wardrobeFromIds(fallback) });
  }
  try {
    const catalog = ITEMS.map((i) => `${i.id} | ${i.slot} | ${i.name.en} | ${i.subjects.join(",")}`).join("\n");
    const { data } = await completeJson<{ item_ids?: unknown }>({ role: "digest", maxTokens: 300, messages: [{ role: "user", content: outfitPrompt(subject, catalog) }] });
    const ids = Array.isArray(data.item_ids) ? data.item_ids.map(String) : [];
    // wardrobeFromIds ignores any id that is not in the catalog.
    return json({ source: "llm", pack: null, wardrobe: wardrobeFromIds(ids) });
  } catch (err) {
    return fail(describeAiError(err), 502);
  }
}
