"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Source, Teacher } from "@/lib/types";

export type TeacherView = Teacher & { source_count: number; topic_count: number };

/** Load a teacher and auto-save patches (debounced) so drafts survive leaving mid-wizard. */
export function useTeacher(id: string) {
  const [teacher, setTeacher] = useState<TeacherView | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const pending = useRef<Partial<Teacher>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    try {
      const d = await api<{ teacher: TeacherView; sources: Source[] }>(`/api/teachers/${id}`);
      setTeacher(d.teacher);
      setSources(d.sources);
    } catch (e) { setError((e as Error).message); }
  }, [id]);

  useEffect(() => { void reload(); }, [reload]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const patch = pending.current;
    pending.current = {};
    if (!Object.keys(patch).length) return;
    setSaving(true);
    try {
      const d = await api<{ teacher: TeacherView }>(`/api/teachers/${id}`, { method: "PATCH", json: patch });
      setTeacher((cur) => (cur ? { ...cur, ...d.teacher, ...pending.current } : d.teacher));
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }, [id]);

  const patch = useCallback((p: Partial<Teacher>, immediate = false) => {
    setTeacher((cur) => (cur ? { ...cur, ...p } : cur));
    pending.current = { ...pending.current, ...p };
    if (timer.current) clearTimeout(timer.current);
    if (immediate) return flush();
    timer.current = setTimeout(() => void flush(), 700);
    return Promise.resolve();
  }, [flush]);

  // Save on unmount / tab close.
  useEffect(() => {
    const onHide = () => {
      if (Object.keys(pending.current).length) {
        navigator.sendBeacon?.(`/api/teachers/${id}/beacon`, JSON.stringify(pending.current));
      }
    };
    window.addEventListener("pagehide", onHide);
    return () => { window.removeEventListener("pagehide", onHide); void flush(); };
  }, [id, flush]);

  return { teacher, sources, setSources, error, saving, patch, flush, reload };
}
