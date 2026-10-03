"use client";

import { FormEvent, useState } from "react";
import { safeNextPath } from "@/lib/auth";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await r.json();
      if (!data.ok) {
        setError(data.error || "Sign-in failed.");
        return;
      }
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.replace(safeNextPath(next));
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-dvh grid place-items-center px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 bg-peppes-panel border border-peppes-border rounded-xl p-6"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-peppes-red flex items-center justify-center font-black text-white">
            P
          </div>
          <div>
            <div className="font-bold leading-tight">Peppes Route Optimizer</div>
            <div className="text-xs text-peppes-subtle">Enter the shop password</div>
          </div>
        </div>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-peppes-dark border border-peppes-border rounded-lg px-3 py-2.5 outline-none focus:border-peppes-red"
          placeholder="Password"
        />
        {error && <div className="text-sm text-red-400">{error}</div>}
        <button
          type="submit"
          disabled={busy || !password}
          className="w-full bg-peppes-red rounded-lg py-2.5 font-semibold disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
