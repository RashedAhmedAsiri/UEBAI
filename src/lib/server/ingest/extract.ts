import "server-only";
import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { client, isLive } from "../../ai/provider";
import { MODELS, supportsEffort } from "../../ai/models";

export interface PageText { page: number; text: string }
export interface Extracted { pages: PageText[]; pageCount: number; synthetic: boolean }

const CHARS_PER_SYNTHETIC_PAGE = 3000;

export const SUPPORTED_EXT = [".pdf", ".docx", ".pptx", ".epub", ".txt", ".md", ".markdown", ".png", ".jpg", ".jpeg", ".webp", ".gif"];

export function mimeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return ({
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".epub": "application/epub+zip",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".markdown": "text/markdown",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
  } as Record<string, string>)[ext] ?? "application/octet-stream";
}

/** Cheap page count for the cost estimate (before full extraction). */
export async function quickPageCount(filePath: string, mime: string): Promise<number> {
  if (mime === "application/pdf") {
    const { getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(filePath)));
    return pdf.numPages;
  }
  if (mime.startsWith("image/")) return 1;
  const ex = await extract(filePath, mime, { allowOcr: false }).catch(() => null);
  return ex?.pageCount ?? Math.max(1, Math.round(fs.statSync(filePath).size / 6000));
}

export async function extract(filePath: string, mime: string, opts: { allowOcr: boolean } = { allowOcr: true }): Promise<Extracted> {
  const buf = fs.readFileSync(filePath);
  switch (mime) {
    case "application/pdf":
      return extractPdf(buf, opts.allowOcr);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return syntheticPages(await docxToMarkdown(buf));
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return extractPptx(buf);
    case "application/epub+zip":
      return syntheticPages(await epubToText(buf));
    case "text/plain":
    case "text/markdown":
      return syntheticPages(buf.toString("utf8"));
    default:
      if (mime.startsWith("image/")) {
        if (!opts.allowOcr) return { pages: [{ page: 1, text: "" }], pageCount: 1, synthetic: false };
        return { pages: [{ page: 1, text: await ocrImage(buf, mime) }], pageCount: 1, synthetic: false };
      }
      throw new Error(`Unsupported file type: ${mime}`);
  }
}

async function extractPdf(buf: Buffer, allowOcr: boolean): Promise<Extracted> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = (text as string[]).map((t, i) => ({ page: i + 1, text: t ?? "" }));
  const chars = pages.reduce((n, p) => n + p.text.trim().length, 0);
  // Scanned PDF (no text layer): OCR with a vision-capable model.
  if (chars < totalPages * 40 && allowOcr) {
    if (!isLive()) throw new Error("This PDF looks scanned (no text layer). OCR needs an AI key — add one to .env.local.");
    return { pages: await ocrPdf(buf, totalPages), pageCount: totalPages, synthetic: false };
  }
  return { pages, pageCount: totalPages, synthetic: false };
}

async function ocrPdf(buf: Buffer, totalPages: number): Promise<PageText[]> {
  if (totalPages > 100 || buf.length > 30 * 1024 * 1024) {
    throw new Error("Scanned PDF is too large to OCR in one go (max 100 pages / 30 MB). Split it and upload the parts.");
  }
  const msg = await client().messages.stream({
    model: MODELS.notes,
    max_tokens: 64000,
    ...(supportsEffort(MODELS.notes) ? { output_config: { effort: "low" } } : {}),
    messages: [{
      role: "user",
      content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } },
        { type: "text", text: "Transcribe this scanned document faithfully (keep its language). Before each page write a marker line exactly like `[[PAGE 3]]`. Keep headings on their own lines. Output only the transcription." },
      ],
    }],
  }).finalMessage();
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
  const pages: PageText[] = [];
  const parts = text.split(/\[\[PAGE (\d+)\]\]/);
  for (let i = 1; i < parts.length; i += 2) pages.push({ page: Number(parts[i]), text: parts[i + 1] ?? "" });
  return pages.length ? pages : [{ page: 1, text }];
}

async function ocrImage(buf: Buffer, mime: string): Promise<string> {
  if (!isLive()) throw new Error("Reading images needs an AI key — add one to .env.local.");
  const msg = await client().messages.create({
    model: MODELS.notes,
    max_tokens: 8000,
    ...(supportsEffort(MODELS.notes) ? { output_config: { effort: "low" } } : {}),
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mime as "image/png", data: buf.toString("base64") } },
        { type: "text", text: "Transcribe all text in this image faithfully (keep its language). Describe any diagram in one bracketed line. Output only the transcription." },
      ],
    }],
  });
  return msg.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
}

function syntheticPages(text: string): Extracted {
  const pages: PageText[] = [];
  const paras = text.split(/\n/);
  let cur = "";
  for (const line of paras) {
    if (cur.length + line.length > CHARS_PER_SYNTHETIC_PAGE && cur.length > 0) {
      pages.push({ page: pages.length + 1, text: cur });
      cur = "";
    }
    cur += line + "\n";
  }
  if (cur.trim()) pages.push({ page: pages.length + 1, text: cur });
  return { pages, pageCount: pages.length, synthetic: true };
}

const decodeEntities = (s: string) =>
  s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

/** Minimal HTML → Markdown-ish text keeping headings and list items. */
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
      .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => `\n${"#".repeat(Number(n))} ${t.replace(/<[^>]+>/g, "").trim()}\n`)
      .replace(/<li[^>]*>/gi, "\n- ")
      .replace(/<\/(p|div|li|tr|section|article|blockquote)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<(td|th)[^>]*>/gi, " | ")
      .replace(/<[^>]+>/g, ""),
  ).replace(/\n{3,}/g, "\n\n");
}

async function docxToMarkdown(buf: Buffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.convertToHtml({ buffer: buf });
  return htmlToText(value);
}

async function extractPptx(buf: Buffer): Promise<Extracted> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files)
    .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
    .sort((a, b) => Number(a.match(/(\d+)\.xml/)![1]) - Number(b.match(/(\d+)\.xml/)![1]));
  const pages: PageText[] = [];
  for (const [i, f] of slides.entries()) {
    const xml = await zip.file(f)!.async("string");
    const paras = xml.split(/<\/a:p>/).map((p) => decodeEntities([...p.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(""))).filter((s) => s.trim());
    // First text run of a slide is usually its title → make it a heading.
    const text = paras.length ? `## ${paras[0]}\n${paras.slice(1).join("\n")}` : "";
    pages.push({ page: i + 1, text });
  }
  return { pages, pageCount: pages.length, synthetic: false };
}

async function epubToText(buf: Buffer): Promise<string> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buf);
  const container = await zip.file("META-INF/container.xml")?.async("string");
  const opfPath = container?.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) throw new Error("Invalid EPUB (no container.xml)");
  const opf = await zip.file(opfPath)!.async("string");
  const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const manifest = new Map([...opf.matchAll(/<item\b[^>]*>/g)].map((m) => {
    const id = m[0].match(/\bid="([^"]+)"/)?.[1] ?? "";
    const href = m[0].match(/\bhref="([^"]+)"/)?.[1] ?? "";
    return [id, href] as const;
  }));
  const spine = [...opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)].map((m) => m[1]);
  const out: string[] = [];
  for (const id of spine) {
    const href = manifest.get(id);
    if (!href) continue;
    const html = await zip.file(decodeURIComponent(base + href))?.async("string");
    if (html) out.push(htmlToText(html));
  }
  return out.join("\n\n");
}
