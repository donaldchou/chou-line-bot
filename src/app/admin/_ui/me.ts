"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Me } from "@/lib/page-access";

/* 目前登入的帳號、驗證碼解鎖狀態（整個後台共用，只抓一次） */

type State = { me: Me | null; unlockUntil: number | null };
let state: State = { me: null, unlockUntil: null };
let started = false;
const listeners = new Set<() => void>();
const emit = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function goLogin() {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
}

async function load() {
  const res = await fetch("/api/auth/me", { cache: "no-store" });
  if (res.status === 401) return goLogin();
  if (!res.ok) return;
  const me = (await res.json()) as Me;
  emit({ me });
  if (me.role === "admin") {
    const u = await fetch("/api/admin/system/unlock", { cache: "no-store" })
      .then((r) => r.json())
      .catch(() => ({}));
    emit({ unlockUntil: typeof u.expiresAt === "number" ? u.expiresAt : null });
  }
}

function useStore<T>(pick: (s: State) => T, server: T) {
  useEffect(() => {
    if (started) return;
    started = true;
    void load();
  }, []);
  return useSyncExternalStore(subscribe, () => pick(state), () => server);
}

export const useMe = () => useStore((s) => s.me, null);
/** 管理者才能修改；一般使用者只能看 */
export const useCanEdit = () => useMe()?.role === "admin";
export const useUnlock = () => useStore((s) => s.unlockUntil, null);
export const isUnlocked = () => !!state.unlockUntil && state.unlockUntil > Date.now();

export async function unlock(code: string, hours: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch("/api/admin/system/unlock", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, hours }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: d.error ?? `HTTP ${res.status}` };
  emit({ unlockUntil: d.expiresAt });
  return { ok: true };
}

export async function lock() {
  await fetch("/api/admin/system/unlock", { method: "DELETE" }).catch(() => {});
  emit({ unlockUntil: null });
}

export async function logout() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  started = false;
  state = { me: null, unlockUntil: null };
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  location.href = "/login";
}
