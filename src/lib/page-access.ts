/**
 * 一般使用者的頁面權限（前後端共用），照 chou-platform 的做法：
 * 帳號看得到的頁面 ＝ 後台「① 一般使用者可以看的頁面」有勾，且「② 個別帳號再隱藏」沒勾；管理者永遠看得到全部。
 * 後台管理只給管理者，不在這裡。
 */
export const USER_PAGES = [
  { key: "overview", label: "總覽", group: "總覽", href: "/admin" },
  { key: "customers", label: "客戶列表", group: "客戶", href: "/admin/customers" },
  { key: "chat", label: "對話", group: "客戶", href: "/admin/chat" },
  { key: "push", label: "群發訊息", group: "客戶", href: "/admin/push" },
  { key: "orders", label: "LINE 訂單", group: "訂單", href: "/admin/orders" },
  { key: "capacity", label: "接單設定", group: "訂單", href: "/admin/capacity" },
] as const;

export type PageKey = (typeof USER_PAGES)[number]["key"];
export const PAGE_KEYS: PageKey[] = USER_PAGES.map((p) => p.key);
export const isPageKey = (v: unknown): v is PageKey => PAGE_KEYS.includes(v as PageKey);
export const pageLabel = (k: PageKey) => USER_PAGES.find((p) => p.key === k)!.label;
export const pageHref = (k: PageKey) => USER_PAGES.find((p) => p.key === k)!.href;

/** 只有管理者能進的頁面 */
export const SYSTEM_HREF = "/admin/system";

/** 網址屬於哪個頁面；不屬於任何一個（後台管理）回 null */
export function pageOfPath(path: string): PageKey | null {
  if (path === "/admin") return "overview";
  const hit = USER_PAGES.filter((p) => p.href !== "/admin" && (path === p.href || path.startsWith(p.href + "/"))).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
  return hit?.key ?? null;
}

export type Role = "admin" | "user";

export type Me = { id: string; email: string; name: string; role: Role; pages: PageKey[] };

export type PageAccessSettings = {
  /** ① 一般使用者可以看的頁面 */
  allowed: PageKey[];
  /** 一般使用者帳號與各自另外隱藏的頁面 */
  users: { id: string; email: string; name: string; active: boolean; hiddenPages: PageKey[] }[];
};
