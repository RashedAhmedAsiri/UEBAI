"use client";
import { useState } from "react";
import { useI18n } from "@/lib/client/i18n";
import { GelButton } from "@/components/skeuo";

/** Password gate for hosted deployments (see src/proxy.ts). */
export default function Login() {
  const { t, tm } = useI18n();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      if (!res.ok) { setError(tm((await res.json().catch(() => ({}))).error ?? "Wrong password.")); return; }
      // Only same-site paths: never follow "//evil.com" style redirects.
      const next = new URLSearchParams(window.location.search).get("next") ?? "/";
      window.location.href = next.startsWith("/") && !next.startsWith("//") ? next : "/";
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <div className="folder-page manila" data-tab={t("Sign in")} style={{ maxWidth: 440, margin: "40px auto" }}>
        <form className="form-sheet paper stack" onSubmit={submit}>
          <h1 className="typewriter" style={{ fontSize: 26, margin: 0 }}>🔒 {t("Sign in")}</h1>
          <p className="hand" style={{ margin: 0 }}>{t("This site is private. Enter the password to continue.")}</p>
          <label className="field">
            <span>{t("Password")}</span>
            <input className="typed-input" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          {error && <p role="alert" style={{ color: "#8e2c2c", margin: 0 }}>{error}</p>}
          <GelButton type="submit" color="green" disabled={busy || !password}>{t("Enter")}</GelButton>
        </form>
      </div>
    </main>
  );
}
