import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_MAX_AGE, authEnabled, passwordMatches, sessionToken } from "@/lib/auth";
import { fail } from "@/lib/server/teachers";

export const runtime = "nodejs";

// Brute-force guard: at most MAX_FAILS wrong passwords per IP per window, plus a global cap
// because X-Forwarded-For can be spoofed to look like many IPs.
const MAX_FAILS = 8;
const MAX_FAILS_TOTAL = 40;
const WINDOW_MS = 15 * 60_000;
const ALL = "*";
type G = typeof globalThis & { __roboprofLoginFails?: Map<string, number[]> };
const fails: Map<string, number[]> = ((globalThis as G).__roboprofLoginFails ??= new Map());

function clientIp(req: Request) {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
}

export async function POST(req: Request) {
  if (!authEnabled()) return NextResponse.json({ ok: true });
  const ip = clientIp(req);
  const now = Date.now();
  const recent = (fails.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  const total = (fails.get(ALL) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_FAILS || total.length >= MAX_FAILS_TOTAL) {
    console.warn(`[login] locked ip=${ip} (${recent.length} recent / ${total.length} total failures)`);
    return fail("Too many attempts — try again in a few minutes.", 429);
  }

  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (typeof password !== "string" || !passwordMatches(password)) {
    fails.set(ip, [...recent, now]);
    fails.set(ALL, [...total, now]);
    console.warn(`[login] wrong password ip=${ip} (${recent.length + 1}/${MAX_FAILS})`);
    return fail("Wrong password.", 401);
  }
  console.log(`[login] ok ip=${ip}`);
  fails.delete(ip);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    // Always Secure: the public link is HTTPS, and browsers also accept Secure cookies on http://localhost.
    secure: true,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
