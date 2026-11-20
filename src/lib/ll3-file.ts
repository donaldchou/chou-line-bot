import { createHmac, randomBytes } from "node:crypto";

/**
 * ll3 主機的檔案 API（https://www.ll3.com.tw/platform/file_api_line.asp，原始碼在 chou-suda-print\platform_change_code）。
 * 問答照片存在主機的 /platform/chou_line/qa/<name>.jpg（資料夾擋掉直接下載），透過 /api/qa-photo/<name>.jpg 轉給 LINE 和後台。
 * 圖文選單圖片存在 /platform/chou_line/richmenu/<name>.png|jpg，後台透過 /api/admin/richmenu/image 看。
 * 每個請求都用共用金鑰簽章：HMAC-SHA256(LL3_FILE_KEY, a|p|id|n|size|ts)，ts 是 UTC 秒數，10 分鐘內有效。
 */

const API = "https://www.ll3.com.tw/platform/file_api_line.asp";
/** 主機的 ASP 一次只收約 200KB，檔案要切成小塊送 */
const CHUNK = 150_000;
/** 照片檔名（不含資料夾）：24 個字的亂數，猜不到 */
export const PHOTO_NAME = /^[a-f0-9]{24}\.jpg$/;

export class FileError extends Error {}

function signed(a: string, p = "", id = "", n = "", size = "") {
  const key = process.env.LL3_FILE_KEY;
  if (!key) throw new FileError("伺服器尚未設定 LL3_FILE_KEY");
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", key).update([a, p, id, n, size, ts].join("|")).digest("hex");
  return `${API}?${new URLSearchParams({ a, p, id, n, size, ts, sig })}`;
}

async function call(url: string, init?: RequestInit) {
  let res: Response;
  try {
    res = await fetch(url, { cache: "no-store", ...init });
  } catch (e) {
    throw new FileError(`連不上 ll3 檔案主機：${e instanceof Error ? e.message : e}`);
  }
  const d = (await res.json().catch(() => null)) as { ok?: boolean; status?: number; error?: string } | null;
  if (!res.ok || !d?.ok) throw new FileError(`ll3 檔案主機錯誤（${d?.status ?? res.status}）：${d?.error ?? "回應不是 JSON"}`);
  return d;
}

/** 存一個檔案到 <folder>/<亂數>.<ext>，回傳檔名（不含資料夾） */
async function putFile(folder: string, ext: string, bytes: Uint8Array) {
  const id = randomBytes(10).toString("hex");
  const name = `${randomBytes(12).toString("hex")}.${ext}`;
  const count = Math.ceil(bytes.length / CHUNK);
  await Promise.all(
    Array.from({ length: count }, (_, k) =>
      call(signed("put", "", id, String(k)), {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes.subarray(k * CHUNK, (k + 1) * CHUNK) as BodyInit,
      }),
    ),
  );
  await call(signed("done", `${folder}/${name}`, id, "", String(bytes.length)));
  return name;
}

/** 存一張照片，回傳檔名 */
export const putPhoto = (bytes: Uint8Array) => putFile("qa", "jpg", bytes);

/* ---------- 圖文選單圖片：/platform/chou_line/richmenu/<name>.png|jpg ---------- */

export const MENU_IMAGE_NAME = /^[a-f0-9]{24}\.(png|jpg)$/;

export const putMenuImage = (bytes: Uint8Array, ext: "png" | "jpg") => putFile("richmenu", ext, bytes);

export async function deleteMenuImage(name: string) {
  if (!MENU_IMAGE_NAME.test(name)) return;
  await call(signed("del", `richmenu/${name}`));
}

/** 讀圖文選單圖片；找不到回 null */
export async function getMenuImage(name: string) {
  if (!MENU_IMAGE_NAME.test(name)) return null;
  const res = await fetch(signed("get", `richmenu/${name}`), { cache: "no-store" });
  if (!res.ok || res.headers.get("content-type")?.startsWith("application/json")) return null;
  return new Uint8Array(await res.arrayBuffer());
}

/** ll3 上所有圖文選單圖片（清掉沒用到的用）：檔名與上傳時間（毫秒） */
export async function listMenuImages() {
  const d = (await call(signed("list"))) as unknown as { files?: { p: string; t: number }[] };
  return (d.files ?? []).filter((f) => f.p.startsWith("richmenu/")).map((f) => ({ name: f.p.slice("richmenu/".length), at: f.t * 1000 }));
}

export async function deletePhoto(name: string) {
  if (!PHOTO_NAME.test(name)) return;
  await call(signed("del", `qa/${name}`));
}

/** 讀照片；找不到回 null */
export async function getPhoto(name: string) {
  if (!PHOTO_NAME.test(name)) return null;
  const res = await fetch(signed("get", `qa/${name}`), { cache: "no-store" });
  if (!res.ok || !res.body || res.headers.get("content-type")?.startsWith("application/json")) return null;
  return res;
}
