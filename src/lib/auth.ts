import crypto from "node:crypto";

/**
 * Optional site password for hosted deployments. When SITE_PASSWORD is unset (local use),
 * everything stays open. The session cookie holds an HMAC derived from the password, so
 * changing the password signs everyone out.
 */
export const SESSION_COOKIE = "roboprof_session";
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

export function authEnabled(): boolean {
  return Boolean(process.env.SITE_PASSWORD);
}

function hmac(value: string): Buffer {
  return crypto.createHmac("sha256", `${process.env.SITE_PASSWORD ?? ""}:${process.env.SESSION_SECRET ?? ""}`).update(value).digest();
}

export function sessionToken(): string {
  return hmac("roboprof-session-v1").toString("base64url");
}

export function isValidSession(value: string | undefined): boolean {
  if (!authEnabled()) return true;
  if (!value) return false;
  const given = Buffer.from(value);
  const expected = Buffer.from(sessionToken());
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** Constant-time password check (both sides hashed to equal length first). */
export function passwordMatches(input: string): boolean {
  const a = crypto.createHash("sha256").update(input).digest();
  const b = crypto.createHash("sha256").update(process.env.SITE_PASSWORD ?? "").digest();
  return authEnabled() && crypto.timingSafeEqual(a, b);
}

/** Reads the session cookie from a plain Request (route handlers the proxy skips). */
export function requestHasSession(req: Request): boolean {
  if (!authEnabled()) return true;
  const cookie = req.headers.get("cookie") ?? "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return isValidSession(m ? decodeURIComponent(m[1]) : undefined);
}
