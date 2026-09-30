import "server-only";
import { NextResponse } from "next/server";
import { db, now, save, uid } from "./db";
import { kick } from "./jobs";
import { defaultPersonality, defaultRobot, defaultSubject } from "../catalog";
import type { Teacher } from "../types";
import { templateSetup, type TemplateId } from "../templates";

export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}
export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function getTeacher(id: string): Teacher | undefined {
  kick(); // make sure queued ingestion resumes after a restart
  return db().teachers.find((t) => t.id === id);
}

export function createTeacher(lang: "ar" | "en" = "ar", template?: TemplateId): Teacher {
  const personality = defaultPersonality(lang);
  const ready = template ? templateSetup(template) : null;
  const t: Teacher = {
    id: uid(),
    name: personality.name,
    title: personality.title,
    robot_config: defaultRobot(),
    personality,
    subject: defaultSubject(lang),
    knowledge_mode: "internet",
    avatar_url: null,
    draft: true,
    wizard_step: 1,
    last_topic_title: null,
    tokens_saved: 0,
    created_at: now(),
    updated_at: now(),
    // Ready-made teachers skip the wizard.
    ...(ready ? { ...ready, draft: false, wizard_step: 5 } : {}),
  };
  db().teachers.push(t);
  save();
  return t;
}

/** Teacher + light summary for the Staff Room. */
export function teacherSummary(t: Teacher) {
  const d = db();
  return {
    ...t,
    source_count: d.sources.filter((s) => s.teacher_id === t.id && s.status === "ready").length,
    topic_count: d.topics.filter((x) => x.teacher_id === t.id).length,
  };
}
