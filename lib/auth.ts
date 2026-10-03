/**
 * Minimal shared-password gate for hosted deployments. When APP_PASSWORD is
 * unset (local dev) the app is open; when set, every page and API route needs
 * the cookie that /api/login issues. Uses Web Crypto so it runs in both the
 * Edge middleware and Node API routes.
 */

export const AUTH_COOKIE = "peppes_auth";
export const AUTH_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // stay signed in for 30 days

/** Paths reachable without signing in: the login flow and home-screen assets. */
const PUBLIC_PATHS = new Set([
  "/login",
  "/api/login",
  "/manifest.webmanifest",
  "/apple-icon",
  "/favicon.ico",
]);

export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/icon/")
  );
}

/** Cookie value for a password: hex SHA-256, so the password itself is never stored client-side. */
export async function authToken(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`peppes-routing:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Length-checked constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isAuthorized(
  cookieValue: string | undefined,
  password: string | undefined,
): Promise<boolean> {
  if (!password) return true;
  if (!cookieValue) return false;
  return safeEqual(cookieValue, await authToken(password));
}

/** Only allow same-site relative redirects after login (no open redirect). */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}
