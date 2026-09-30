"use client";
import { create } from "zustand";
import { play } from "@/lib/client/sound";

interface Toast { id: number; text: string; kind: "info" | "error" }
interface ToastStore { toasts: Toast[]; push: (text: string, kind?: Toast["kind"]) => void; dismiss: (id: number) => void }

let n = 0;
export const useToasts = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (text, kind = "info") => {
    const id = ++n;
    set({ toasts: [...get().toasts, { id, text, kind }].slice(-4) });
    play(kind === "error" ? "error" : "pop");
    setTimeout(() => get().dismiss(id), kind === "error" ? 7000 : 4500);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (text: string, kind?: Toast["kind"]) => useToasts.getState().push(text, kind);

export function Toasts() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind === "error" ? "error" : ""}`} onClick={() => dismiss(t.id)}>{t.text}</div>
      ))}
    </div>
  );
}
