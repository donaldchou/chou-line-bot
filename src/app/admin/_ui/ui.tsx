"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/* 後台共用：API 呼叫、輪詢、時間格式、進度標籤 */

export type Stage = "ask" | "fill" | "confirm" | "ordered" | "shipped" | "lost";

export const STAGE_UI: Record<Stage, { name: string; bg: string; fg: string; dot: string }> = {
  ask: { name: "詢問中", bg: "#E3ECF7", fg: "#1D4E8F", dot: "#3F7FBF" },
  fill: { name: "填資料中", bg: "#FFF1DC", fg: "#8A4B00", dot: "#D08A1E" },
  confirm: { name: "確認卡未按", bg: "#EFE8FA", fg: "#5B3A9A", dot: "#7A5BC0" },
  ordered: { name: "已下單", bg: "#DFF2E7", fg: "#17613E", dot: "#1E9E5F" },
  shipped: { name: "已寄出", bg: "#14342A", fg: "#FFFFFF", dot: "#14342A" },
  lost: { name: "沒有下單", bg: "#ECEDEB", fg: "#4F5A53", dot: "#9AA39D" },
};
export const STAGE_KEYS = Object.keys(STAGE_UI) as Stage[];

export const ALERT_UI: Record<string, { name: string; bg: string; fg: string }> = {
  unanswered: { name: "機器人答不出來", bg: "#FDE2DE", fg: "#9E2A1C" },
  human: { name: "想找真人", bg: "#FFF1DC", fg: "#8A4B00" },
  confirm: { name: "確認卡未按", bg: "#EFE8FA", fg: "#5B3A9A" },
  notify: { name: "待寄出通知", bg: "#E3ECF7", fg: "#1D4E8F" },
};

export const SYS_LABEL: Record<string, string> = { kaki: "甜柿", peach: "水蜜桃" };

export class ApiError extends Error {}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    method: init?.method ?? (init?.json !== undefined ? "POST" : "GET"),
    headers: init?.json !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
    cache: "no-store",
  });
  if (res.status === 401) {
    // 登入過期：整頁換到登入頁（這裡不是元件，沒有 router 可用）
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
    throw new ApiError("請先登入");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `錯誤（HTTP ${res.status}）`);
  return data as T;
}

/** 定時重新抓資料（分頁在背景時暫停） */
export function usePoll<T>(url: string | null, ms: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!url) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(url);
      if (n === seq.current) {
        setData(d);
        setError("");
      }
    } catch (e) {
      if (n === seq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    if (!url) return;
    const first = setTimeout(load, 0);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, ms);
    const onVis = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(first);
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [url, ms, load]);

  return { data, error, loading, reload: load };
}

const TZ = "Asia/Taipei";
const part = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleString("zh-TW", { timeZone: TZ, hourCycle: "h23", ...o });
const dayKey = (d: Date) => part(d, { year: "numeric", month: "2-digit", day: "2-digit" });

export const clock = (iso: string | null) => (iso ? part(new Date(iso), { hour: "2-digit", minute: "2-digit" }) : "");
export const mdhm = (iso: string | null) =>
  iso ? `${part(new Date(iso), { month: "numeric", day: "numeric" })} ${clock(iso)}` : "";
export const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  if (dayKey(d) === dayKey(now)) return `今天 ${part(d, { month: "numeric", day: "numeric" })}`;
  if (dayKey(d) === dayKey(new Date(now.getTime() - 86400_000))) return `昨天 ${part(d, { month: "numeric", day: "numeric" })}`;
  return part(d, { year: "numeric", month: "numeric", day: "numeric", weekday: "short" });
};
export const sameDay = (a: string, b: string) => dayKey(new Date(a)) === dayKey(new Date(b));

/** 「12 分鐘前」「5 小時前」「昨天 18:30」「11/3」 */
export function ago(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const s = (Date.now() - d.getTime()) / 1000;
  if (s < 60) return "剛剛";
  if (s < 3600) return `${Math.floor(s / 60)} 分鐘前`;
  if (dayKey(d) === dayKey(new Date())) return s < 6 * 3600 ? `${Math.floor(s / 3600)} 小時前` : clock(iso);
  if (dayKey(d) === dayKey(new Date(Date.now() - 86400_000))) return `昨天 ${clock(iso)}`;
  if (s < 7 * 86400) return `${Math.ceil(s / 86400)} 天前`;
  return part(d, { month: "numeric", day: "numeric" });
}

export const money = (n: number) => `NT$ ${n.toLocaleString()}`;

export function Badge({ bg, fg, children, small }: { bg: string; fg: string; children: ReactNode; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full font-bold ${small ? "h-5 px-2 text-[11px]" : "h-6 px-2.5 text-xs"}`}
      style={{ background: bg, color: fg }}
    >
      {children}
    </span>
  );
}

export const StageBadge = ({ stage, small }: { stage: Stage; small?: boolean }) => (
  <Badge bg={STAGE_UI[stage].bg} fg={STAGE_UI[stage].fg} small={small}>
    {STAGE_UI[stage].name}
  </Badge>
);

export function ProdBadge({ sys, text }: { sys: string | null; text: string }) {
  const peach = sys === "peach";
  return (
    <Badge bg={peach ? "#FBE6EE" : "#FCEBDA"} fg={peach ? "#93325A" : "#8F4708"} small>
      {text}
    </Badge>
  );
}

const AV = ["#5C7FA3", "#9A6A8F", "#B0753A", "#4F8A6E", "#7A5BC0", "#C06A4A", "#5B7F5A", "#A35C7A", "#6A7FA0", "#7B7F84"];
export function Avatar({ id, name, picture, size = 40 }: { id: string; name: string; picture?: string; size?: number }) {
  const bg = AV[[...id].reduce((s, c) => s + c.charCodeAt(0), 0) % AV.length];
  if (picture)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={picture} alt="" width={size} height={size} className="flex-none rounded-full object-cover" style={{ width: size, height: size }} />;
  return (
    <span
      className="flex flex-none items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, background: bg, fontSize: size * 0.38 }}
      aria-hidden="true"
    >
      {[...(name || "?")][0]}
    </span>
  );
}

export function ErrorBar({ messages }: { messages: (string | undefined | null)[] }) {
  const list = messages.filter(Boolean);
  if (!list.length) return null;
  return (
    <div role="alert" className="mb-4 rounded-xl border border-[#F2C4BC] bg-[#FDECEA] px-4 py-3 text-sm text-[#9E2A1C]">
      {list.map((m, i) => (
        <div key={i}>{m}</div>
      ))}
    </div>
  );
}

export const card = "rounded-xl border border-line bg-white";
export const chip = (on: boolean) =>
  `inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm ${on ? "border-forest bg-forest font-bold text-white" : "border-field bg-white text-ink hover:bg-ground"}`;
export const btn = (kind: "pri" | "line" | "plain" = "plain") =>
  `inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border px-4 text-sm font-bold disabled:opacity-50 ${
    kind === "pri"
      ? "border-leaf bg-leaf text-white hover:bg-[#185a3b]"
      : kind === "line"
        ? "border-linegreen bg-linegreen text-white hover:bg-[#05b14c]"
        : "border-field bg-white text-ink hover:bg-ground"
  }`;
