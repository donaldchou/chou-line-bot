import { ChatMessage, LineUser, type LineUserDoc, type Stage } from "./models";
import type { Sys } from "./ll3";

/** 訊息存檔＋更新客戶「最後一則訊息」（後台列表用） */
export async function logMessage(userId: string, role: "user" | "model", text: string, by?: "admin") {
  if (!text) return;
  const at = new Date();
  await ChatMessage.create({ userId, role, text, at, ...(by ? { by } : {}) });
  await LineUser.updateOne({ _id: userId }, { $set: { lastText: previewText(text), lastRole: role, lastAt: at } });
}

/** 列表上顯示的一行：去掉 [系統紀錄]，沒有文字就顯示紀錄本身 */
export function previewText(text: string) {
  const plain = text
    .split("\n")
    .filter((l) => !/^\[.*\]$/.test(l.trim()))
    .join(" ")
    .trim();
  return (plain || text.replace(/^\[|\]$/g, "")).slice(0, 80);
}

const TERMINAL: (Stage | null | undefined)[] = [null, undefined, "ordered", "shipped", "lost"];

/**
 * 更新客戶進度：詢問中 → 填資料中 → 確認卡未按 → 已下單 → 已寄出（沒有下單另計）。
 * 已下單／已寄出／沒有下單的客人再來詢問，就開始新的一輪。
 */
export async function setStage(
  userId: string,
  stage: Stage,
  opts: { sys?: Sys; missing?: string; contact?: { name: string; phone: string } } = {},
) {
  const u = await LineUser.findById(userId, { stage: 1, cycle: 1 }).lean<Pick<LineUserDoc, "stage" | "cycle">>();
  if (!u) return;
  const now = new Date();
  const cur = u.stage ?? null;
  const set: Record<string, unknown> = {};
  let cycle = u.cycle ?? null;
  const newCycle = () => (cycle = { at: now, sys: opts.sys });

  if (stage === "ask") {
    if (!TERMINAL.includes(cur) && cycle) {
      // 填資料中、確認卡未按時又問問題：進度不倒退
      if (opts.sys && !cycle.sys) cycle = { ...cycle, sys: opts.sys };
    } else {
      newCycle();
      set.stage = "ask";
      set.stageAt = now;
    }
  } else if (stage === "fill" || stage === "confirm" || stage === "ordered") {
    if (!cycle || (TERMINAL.includes(cur) && stage !== "ordered")) newCycle();
    cycle = { ...cycle!, ...(opts.sys ? { sys: opts.sys } : {}) };
    if (!cycle[stage]) cycle[stage] = now;
    set.stage = stage;
    set.stageAt = now;
  } else {
    set.stage = stage;
    set.stageAt = now;
  }
  set.cycle = cycle;
  if (stage === "fill") set.missing = opts.missing ?? "";
  if (opts.contact?.name) set.contact = opts.contact;
  await LineUser.updateOne({ _id: userId }, { $set: set });
}

export const STAGES: { key: Stage; name: string; hint: string }[] = [
  { key: "ask", name: "詢問中", hint: "問價格、產季、看照片" },
  { key: "fill", name: "填資料中", hint: "開始下單，資料還沒給齊" },
  { key: "confirm", name: "確認卡未按", hint: "確認卡已送出，等客人按確認" },
  { key: "ordered", name: "已下單", hint: "已建立訂單，等出貨" },
  { key: "shipped", name: "已寄出", hint: "已傳寄出通知與託運單" },
  { key: "lost", name: "沒有下單", hint: "關心 2 次後仍沒下單" },
];

const FOLLOW_GAP = 6 * 3600_000;

/** 後台顯示的進度：關心 2 次、又過 6 小時客人都沒回，就算「沒有下單」 */
export function viewStage(u: Pick<LineUserDoc, "stage" | "followups" | "lastFollowupAt" | "lastMessageAt">, now = new Date()): Stage {
  const s = u.stage ?? "ask";
  if ((s === "ask" || s === "fill" || s === "confirm") && u.followups >= 2 && u.lastFollowupAt) {
    const f = new Date(u.lastFollowupAt).getTime();
    const replied = u.lastMessageAt && new Date(u.lastMessageAt).getTime() > f;
    if (!replied && now.getTime() - f > FOLLOW_GAP) return "lost";
  }
  return s;
}

export const botPaused = (u: Pick<LineUserDoc, "botPausedUntil">, now = new Date()) =>
  !!u.botPausedUntil && new Date(u.botPausedUntil).getTime() > now.getTime();
