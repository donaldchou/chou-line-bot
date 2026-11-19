import mongoose from "mongoose";
import { connectDB } from "./mongodb";

/**
 * cron-job.org 呼叫 /api/cron/followup 的紀錄（給 ll3 後台 admin.asp「API 排程狀態」看）
 * 一份文件：最後呼叫時間、今天次數（台灣日期）、累計次數、最後結果、最近一次錯誤 key 的時間
 */
type CronStat = {
  _id: string;
  lastCall?: Date;
  lastResult?: Record<string, unknown>;
  dayDate?: string;
  dayCount?: number;
  total?: number;
  badKeyAt?: Date;
};

const ID = "followup";

/** 台灣日期 YYYY-MM-DD */
const twDay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });

async function col() {
  await connectDB();
  return mongoose.connection.db!.collection<CronStat>("cronStats");
}

/** 正確 key 的呼叫：次數 +1，記下結果 */
export async function logCronCall(result: Record<string, unknown>, now = new Date()) {
  const c = await col();
  const day = twDay(now);
  // 跨日時今天次數從 1 開始（用 pipeline 一次更新，避免兩個呼叫同時進來算錯）
  await c.updateOne(
    { _id: ID },
    [
      {
        $set: {
          lastCall: now,
          lastResult: { $literal: result },
          dayCount: { $cond: [{ $eq: ["$dayDate", day] }, { $add: [{ $ifNull: ["$dayCount", 0] }, 1] }, 1] },
          dayDate: day,
          total: { $add: [{ $ifNull: ["$total", 0] }, 1] },
        },
      },
    ],
    { upsert: true },
  );
}

/** 錯誤 key 的呼叫：只記最近一次時間 */
export async function logCronBadKey(now = new Date()) {
  const c = await col();
  await c.updateOne({ _id: ID }, { $set: { badKeyAt: now } }, { upsert: true });
}

/** 給 /api/cron/status：只有時間、次數、結果，沒有 key 或客人資料 */
export async function cronStatus(now = new Date()) {
  const c = await col();
  const s = await c.findOne({ _id: ID });
  return {
    now: now.toISOString(),
    lastCall: s?.lastCall?.toISOString() ?? null,
    todayCount: s?.dayDate === twDay(now) ? (s?.dayCount ?? 0) : 0,
    total: s?.total ?? 0,
    lastResult: s?.lastResult ?? null,
    badKeyAt: s?.badKeyAt?.toISOString() ?? null,
  };
}
