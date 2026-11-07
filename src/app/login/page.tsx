"use client";

import { useEffect, useState } from "react";

const field = "min-h-11 rounded-[10px] border border-field px-3.5 text-base font-normal";

export default function LoginPage() {
  // null＝檢查中；true＝還沒有任何帳號，要先建立第一個管理者
  const [setup, setSetup] = useState<boolean | null>(null);
  const [form, setForm] = useState({ email: "", password: "", name: "", setupPassword: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/setup", { cache: "no-store" })
      .then((r) => r.json())
      .then(
        (d) => setSetup(!!d.needed),
        () => setSetup(false),
      );
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch(setup ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(setup ? form : { email: form.email, password: form.password }),
      });
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
            <span className="text-sm text-mute">{setup ? "第一次使用：建立管理者帳號" : "請用 email 和密碼登入"}</span>
          </div>
        </div>
        {setup && (
          <>
            <p className="rounded-lg bg-[#FFF4E0] px-3 py-2 text-sm text-[#6B3E00]">
              還沒有任何帳號。輸入環境變數 ADMIN_PASSWORD（初始密碼），建立第一個管理者；之後的帳號從「後台管理」新增。
            </p>
            <label className="flex flex-col gap-1.5 text-sm font-bold">
              初始密碼（ADMIN_PASSWORD）
              <input type="password" autoComplete="off" value={form.setupPassword} onChange={set("setupPassword")} required className={field} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-bold">
              名稱
              <input value={form.name} onChange={set("name")} placeholder="例：周先生" className={field} />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1.5 text-sm font-bold">
          Email
          <input type="email" autoComplete="username" value={form.email} onChange={set("email")} required autoFocus className={field} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-bold">
          {setup ? "密碼（至少 8 個字元）" : "密碼"}
          <input
            type="password"
            autoComplete={setup ? "new-password" : "current-password"}
            minLength={setup ? 8 : undefined}
            value={form.password}
            onChange={set("password")}
            required
            className={field}
          />
        </label>
        {err && (
          <p role="alert" className="text-sm text-[#9E2A1C]">
            {err}
          </p>
        )}
        <button type="submit" disabled={busy || setup === null} className="min-h-11 rounded-[10px] bg-leaf font-bold text-white disabled:opacity-60">
          {busy ? "處理中…" : setup ? "建立管理者並登入" : "登入"}
        </button>
      </form>
    </main>
  );
}
