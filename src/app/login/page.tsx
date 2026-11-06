"use client";

import { useState } from "react";

export default function LoginPage() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: pw }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "登入失敗");
      const next = new URLSearchParams(location.search).get("next") ?? "";
      location.href = next.startsWith("/admin") ? next : "/admin";
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-ground px-4">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-line bg-white p-7">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-linegreen font-bold text-white">周</div>
          <div className="flex flex-col">
            <h1 className="text-lg font-bold">周家農場 LINE 客服後台</h1>
            <span className="text-sm text-mute">請輸入管理密碼</span>
          </div>
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-bold">
          密碼
          <input
            type="password"
            autoComplete="current-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            required
            autoFocus
            className="min-h-11 rounded-[10px] border border-field px-3.5 text-base font-normal"
          />
        </label>
        {err && (
          <p role="alert" className="text-sm text-[#9E2A1C]">
            {err}
          </p>
        )}
        <button type="submit" disabled={busy} className="min-h-11 rounded-[10px] bg-leaf font-bold text-white disabled:opacity-60">
          {busy ? "登入中…" : "登入"}
        </button>
      </form>
    </main>
  );
}
