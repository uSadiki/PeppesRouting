import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  AUTH_COOKIE,
  authToken,
  isAuthorized,
  isPublicPath,
  safeEqual,
  safeNextPath,
} from "@/lib/auth";
import { middleware } from "@/middleware";
import { POST as login } from "@/app/api/login/route";

afterEach(() => {
  vi.unstubAllEnvs();
});

const request = (path: string, init: { cookie?: string; body?: unknown } = {}) =>
  new NextRequest(`https://peppes.example${path}`, {
    method: init.body === undefined ? "GET" : "POST",
    headers: init.cookie ? { cookie: `${AUTH_COOKIE}=${init.cookie}` } : {},
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

describe("auth helpers", () => {
  it("derives a stable SHA-256 token that doesn't reveal the password", async () => {
    const t = await authToken("pizza123");
    expect(t).toMatch(/^[0-9a-f]{64}$/);
    expect(t).toBe(await authToken("pizza123"));
    expect(t).not.toBe(await authToken("pizza124"));
    expect(t).not.toContain("pizza123");
  });

  it("compares strings safely", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });

  it("leaves the app open when no password is configured (local dev)", async () => {
    expect(await isAuthorized(undefined, undefined)).toBe(true);
    expect(await isAuthorized(undefined, "")).toBe(true);
  });

  it("requires the matching cookie when a password is configured", async () => {
    expect(await isAuthorized(undefined, "secret")).toBe(false);
    expect(await isAuthorized("garbage", "secret")).toBe(false);
    expect(await isAuthorized(await authToken("secret"), "secret")).toBe(true);
  });

  it("only exposes the login flow and home-screen assets publicly", () => {
    for (const p of ["/login", "/api/login", "/manifest.webmanifest", "/icon/192", "/_next/static/x.js"]) {
      expect(isPublicPath(p)).toBe(true);
    }
    for (const p of ["/", "/api/optimize", "/api/geocode", "/login/../api/optimize"]) {
      expect(isPublicPath(p)).toBe(false);
    }
  });

  it.each([
    [null, "/"],
    ["", "/"],
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/?tab=map", "/?tab=map"],
  ])("sanitises post-login redirect %s → %s", (next, expected) => {
    expect(safeNextPath(next)).toBe(expected);
  });
});

describe("middleware", () => {
  it("lets everything through when APP_PASSWORD is unset", async () => {
    vi.stubEnv("APP_PASSWORD", "");
    const res = await middleware(request("/"));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects signed-out page visits to /login, remembering where they were going", async () => {
    vi.stubEnv("APP_PASSWORD", "secret");
    const res = await middleware(request("/?driver=2"));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.pathname).toBe("/login");
    expect(loc.searchParams.get("next")).toBe("/?driver=2");
  });

  it("blocks signed-out API calls with 401 so nobody can spend the Google quota", async () => {
    vi.stubEnv("APP_PASSWORD", "secret");
    const res = await middleware(request("/api/optimize"));
    expect(res.status).toBe(401);
  });

  it("admits requests carrying a valid session cookie", async () => {
    vi.stubEnv("APP_PASSWORD", "secret");
    const res = await middleware(request("/api/optimize", { cookie: await authToken("secret") }));
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("rejects cookies from an old password after it is rotated", async () => {
    vi.stubEnv("APP_PASSWORD", "new-secret");
    const res = await middleware(request("/", { cookie: await authToken("old-secret") }));
    expect(res.status).toBe(307);
  });
});

describe("POST /api/login", () => {
  it("sets a long-lived, HTTP-only session cookie for the right password", async () => {
    vi.stubEnv("APP_PASSWORD", "secret");
    const res = await login(request("/api/login", { body: { password: "secret" } }));
    expect(res.status).toBe(200);
    const cookie = res.cookies.get(AUTH_COOKIE)!;
    expect(cookie.value).toBe(await authToken("secret"));
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("lax");
    expect(cookie.maxAge).toBe(60 * 60 * 24 * 30);
  });

  it("rejects a wrong password after a brute-force delay, without setting a cookie", async () => {
    vi.stubEnv("APP_PASSWORD", "secret");
    const started = performance.now();
    const res = await login(request("/api/login", { body: { password: "nope" } }));
    expect(performance.now() - started).toBeGreaterThanOrEqual(550);
    expect(res.status).toBe(401);
    expect(res.cookies.get(AUTH_COOKIE)).toBeUndefined();
  });

  it("rejects malformed JSON", async () => {
    vi.stubEnv("APP_PASSWORD", "secret");
    const res = await login(
      new NextRequest("https://peppes.example/api/login", { method: "POST", body: "{" }),
    );
    expect(res.status).toBe(400);
  });
});
