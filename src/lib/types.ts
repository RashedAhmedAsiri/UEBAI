import type { RobotConfig, Personality, Subject, KnowledgeMode } from "./schemas";

export interface Teacher {
  id: string;
  name: string;
  title: string;
  robot_config: RobotConfig;
  personality: Personality;
  subject: Subject;
  knowledge_mode: KnowledgeMode;
  avatar_url: string | null;
  draft: boolean;
  wizard_step: number;
  last_topic_title: string | null;
  tokens_saved: number;
  created_at: string;
  updated_at: string;
}

export type SourceStatus = "awaiting_confirm" | "queued" | "extracting" | "indexing" | "ready" | "failed" | "duplicate";

export interface Source {
  id: string;
  teacher_id: string;
  filename: string;
  label: string; // short display name used in citations, e.g. "Biology 1"
  mime: string;
  sha256: string;
  pages: number;
  status: SourceStatus;
  storage_path: string;
  token_estimate: number;
  cost_estimate_usd: number;
  job_id: string | null;
  error: string | null;
  created_at: string;
}

export interface Unit {
  id: string;
  teacher_id: string;
  title: string;
  order_index: number;
}

export interface SourceRef {
  source_id: string;
  page_start: number;
  page_end: number;
}

export interface Topic {
  id: string;
  teacher_id: string;
  unit_id: string | null;
  parent_topic_id: string | null;
  title: string;
  aliases: string[];
  keywords: string[];
  card_summary: string; // Tier 1
  notes_md: string; // Tier 2
  notes_tokens: number;
  notes_user_edited: boolean;
  paragraph_ids: string[];
  source_refs: SourceRef[];
  dirty: boolean;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface TopicLink {
  topic_a: string;
  topic_b: string;
  kind: "related";
}

export interface Paragraph {
  id: string;
  teacher_id: string;
  source_id: string;
  idx: number;
  page: number;
  text: string;
  norm_hash: string;
  heading: string | null;
}

export interface Passage {
  id: string;
  teacher_id: string;
  topic_id: string;
  source_id: string;
  page_start: number;
  page_end: number;
  text: string;
  tokens: number;
}

export interface MergeLogEntry {
  id: string;
  teacher_id: string;
  action: "merge" | "manual_merge" | "subtopic" | "related" | "split";
  from_topic_ids: string[];
  into_topic_id: string | null;
  reason: string;
  undone: boolean;
  /** State needed to restore exactly: affected topics & passages & links before the action. */
  snapshot: { topics: Topic[]; passages: Passage[]; links: TopicLink[]; created_topic_ids: string[] };
  /** For ingestion merges: the candidate topic that was folded in, so undo can split it back out. */
  candidate?: { title: string; aliases: string[]; description: string; paragraph_ids: string[]; source_refs: SourceRef[]; unit_id: string | null };
  created_at: string;
}

export interface JobProgress {
  stage: string;
  pct: number;
  message: string;
  report?: IngestReport;
}

export interface IngestReport {
  pages: number;
  topics: number;
  new_topics: number;
  merged: number;
  new_units: number;
  skipped_paragraphs: number;
}

/** Where an interrupted ingestion picks up (hosted runs work in time slices). */
export interface IngestCheckpoint {
  stage: "detect" | "canonicalize" | "tiers";
  skipped?: number;
  /** Topic-detection results per batch index (stage "detect"). */
  batches?: Record<number, { title: string; aliases: string[]; description: string; unit: string; paragraphIds: string[] }[]>;
  topic_ids?: string[];
  report?: IngestReport;
}

export interface Job {
  id: string;
  type: "ingest" | "rebuild";
  payload: { source_id?: string; teacher_id: string; topic_ids?: string[]; resume?: IngestCheckpoint };
  status: "queued" | "running" | "done" | "failed";
  attempts: number;
  error: string | null;
  progress: JobProgress;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  teacher_id: string;
  title: string;
  active_topic_ids: string[];
  created_at: string;
}

export interface Citation {
  kind: "book" | "web";
  label: string; // e.g. "Biology 1 · p.142 · Mammals"
  source_id?: string;
  source_label?: string;
  page?: number;
  topic_id?: string;
  topic_title?: string;
  url?: string;
  passage?: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  topic_ids: string[];
  tiers_used: number[];
  tokens_in: number;
  tokens_out: number;
  baseline_tokens: number;
  created_at: string;
}

export interface DB {
  teachers: Teacher[];
  sources: Source[];
  units: Unit[];
  topics: Topic[];
  topic_links: TopicLink[];
  paragraphs: Paragraph[];
  passages: Passage[];
  merge_log: MergeLogEntry[];
  jobs: Job[];
  conversations: Conversation[];
  messages: Message[];
  /** Applied data migrations (see migrate() in server/db.ts). */
  meta?: { text_repair?: number; orphan_prune?: number; starter_pack?: number };
}

export type RobotState = "idle" | "listening" | "thinking" | "talking" | "happy" | "surprised" | "proud" | "confused" | "sleeping" | "booting";
