"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { pageHref, pageLabel, pageOfPath, SYSTEM_HREF, USER_PAGES } from "@/lib/page-access";
import { Icon, type IconName } from "./icons";
import { logout, useMe } from "./me";

/* 左側選單（照 chou-platform 的 app-shell：桌機浮動、可收合成只剩圖示、分組可展開收合；手機用抽屜） */

type Item = { href: string; label: string; icon: IconName };

const ICON: Record<string, IconName> = { overview: "grid", customers: "users", chat: "chat", push: "send", orders: "box", capacity: "sliders" };

const NAV: { group: string; items: Item[] }[] = [...new Set(USER_PAGES.map((p) => p.group))].map((group) => ({
  group,
  items: USER_PAGES.filter((p) => p.group === group).map((p) => ({ href: p.href, label: p.label, icon: ICON[p.key] })),
}));

/** 只有管理者看得到的選單 */
const ADMIN_NAV = { group: "系統", items: [{ href: SYSTEM_HREF, label: "後台管理", icon: "shield" as IconName }] };

/* ---------------- 側邊選單收合狀態，記在這台電腦的瀏覽器 ---------------- */
function localFlag<T extends string>(key: string, fallback: T) {
  const listeners = new Set<() => void>();
  let memory: T | null = null;
  const read = (): T => {
    if (memory !== null) return memory;
    try {
      return (localStorage.getItem(key) as T) ?? fallback;
    } catch {
      return fallback;
    }
  };
  const write = (v: T) => {
    memory = v;
    try {
      localStorage.setItem(key, v);
    } catch {
      // 無法儲存（例如無痕模式）時，只在這次瀏覽有效
    }
    listeners.forEach((l) => l());
  };
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  return function useFlag(): [T, (v: T) => void] {
    return [useSyncExternalStore(subscribe, read, () => fallback), write];
  };
}

const useCollapsedRaw = localFlag<"0" | "1">("chou-line-sidebar-collapsed", "0");
// 收合的分組：JSON 字串，讓 useSyncExternalStore 拿到穩定的值
const useClosedRaw = localFlag<string>("chou-line-nav-closed-groups", "[]");

function useClosedGroups(): [Set<string>, (g: string) => void, (gs: string[]) => void] {
  const [raw, setRaw] = useClosedRaw();
  let closed: Set<string>;
  try {
    closed = new Set(JSON.parse(raw) as string[]);
  } catch {
    closed = new Set();
  }
  const save = (s: Set<string>) => setRaw(JSON.stringify([...s]));
  const toggle = (g: string) => {
    const next = new Set(closed);
    if (next.has(g)) next.delete(g);
    else next.add(g);
    save(next);
  };
  // 全部收合；已經全部收合時改成全部展開
  const toggleAll = (gs: string[]) => save(gs.every((g) => closed.has(g)) ? new Set() : new Set(gs));
  return [closed, toggle, toggleAll];
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [collapsedRaw, setCollapsedRaw] = useCollapsedRaw();
  const collapsed = collapsedRaw === "1";
  const setCollapsed = (v: boolean) => setCollapsedRaw(v ? "1" : "0");
  const [closedGroups, toggleGroup, toggleAllGroups] = useClosedGroups();
  const me = useMe();

  // 一般使用者：只顯示後台「頁面權限」開給他的頁面；還沒載入完先全部顯示
  const groups =
    me?.role === "admin"
      ? [...NAV, ADMIN_NAV]
      : NAV.map((g) => ({
          ...g,
          items: g.items.filter((it) => {
            const page = pageOfPath(it.href);
            return !me || !page || me.pages.includes(page);
          }),
        })).filter((g) => g.items.length);
  const roleLabel = me ? (me.role === "admin" ? "管理者" : "一般使用者（唯讀）") : "";
  const allClosed = groups.every((g) => closedGroups.has(g.group));

  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(href + "/"));

  const nav = (mini: boolean) => (
    <nav aria-label="主選單" className="flex h-full flex-col">
      <div className={`flex items-center gap-2.5 py-5 ${mini ? "justify-center px-2" : "px-5"}`}>
        {/* 點圖示：全部分組展開／收合（只剩圖示的窄選單沒有分組，改成展開選單） */}
        <button
          type="button"
          onClick={() => (mini ? setCollapsed(false) : toggleAllGroups(groups.map((g) => g.group)))}
          title={mini ? "展開選單" : allClosed ? "全部展開" : "全部收合"}
          aria-label={mini ? "展開選單" : allClosed ? "全部展開" : "全部收合"}
          className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl bg-linegreen text-[15px] font-bold text-white hover:bg-[#05b14c]"
        >
          周
        </button>
        {!mini && (
          <div className="min-w-0">
            <div className="truncate text-base font-bold leading-tight text-white">周家農場</div>
            <div className="text-xs text-[#A9C4B6]">LINE 客服後台</div>
          </div>
        )}
      </div>
      <div
        className={`flex-1 space-y-4 overflow-y-auto overflow-x-hidden pb-4 ${mini ? "px-2" : "px-3"}`}
        style={{ scrollbarWidth: "thin", scrollbarColor: "#2b6a52 transparent" }}
      >
        {groups.map((g) => {
          // 只剩圖示的窄選單不分組收合；收合的分組裡如果有目前頁面，標題會亮起來提示
          const isOpen = mini || !closedGroups.has(g.group);
          const hasActive = g.items.some((it) => isActive(it.href));
          return (
            <div key={g.group}>
              {mini ? (
                <div className="mx-2 mb-2 border-t border-forest2" />
              ) : (
                <button
                  type="button"
                  onClick={() => toggleGroup(g.group)}
                  aria-expanded={isOpen}
                  className={`flex w-full cursor-pointer items-center justify-between rounded-md px-2 pb-1 pt-0.5 text-sm font-bold tracking-wider hover:text-white ${
                    !isOpen && hasActive ? "text-white" : "text-[#8FB3A1]"
                  }`}
                >
                  <span>{g.group}</span>
                  <span className="flex items-center gap-1.5">
                    {!isOpen && <span className="text-xs font-normal">{g.items.length}</span>}
                    <Icon name="chevronDown" size={16} className={`transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                  </span>
                </button>
              )}
              {isOpen &&
                g.items.map((it) => (
                  <Link
                    key={it.href}
                    href={it.href}
                    onClick={() => setOpen(false)}
                    title={mini ? it.label : undefined}
                    aria-label={mini ? it.label : undefined}
                    aria-current={isActive(it.href) ? "page" : undefined}
                    className={`flex min-h-11 items-center gap-3 rounded-lg text-[15px] transition-colors ${mini ? "justify-center px-0" : "px-3"} ${
                      isActive(it.href) ? "bg-forest3 font-bold text-white" : "text-[#CFE0D6] hover:bg-forest2 hover:text-white"
                    }`}
                  >
                    <Icon name={it.icon} />
                    {!mini && <span className="truncate">{it.label}</span>}
                  </Link>
                ))}
            </div>
          );
        })}
      </div>
      <div className="space-y-1 border-t border-forest2 p-3">
        <div className={`flex items-center gap-2 text-[15px] text-[#E8F0EB] ${mini ? "justify-center" : "px-2"}`} title={me ? `${me.email}（${roleLabel}）` : undefined}>
          <Icon name="user" size={18} />
          {!mini && (
            <div className="min-w-0">
              <div className="truncate">{me?.name || me?.email || "…"}</div>
              <div className="text-xs text-[#A9C4B6]">{roleLabel}</div>
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          title={mini ? "登出" : undefined}
          aria-label="登出"
          className={`flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-lg text-[15px] text-[#CFE0D6] hover:bg-forest2 hover:text-white ${mini ? "justify-center px-0" : "px-3"}`}
        >
          <Icon name="logout" size={18} /> {!mini && "登出"}
        </button>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh">
      {/* 桌機：浮動、圓角的選單，可收合成只剩圖示 */}
      <aside className={`fixed inset-y-3 left-3 z-30 hidden rounded-2xl bg-forest shadow-xl transition-[width] duration-200 lg:block ${collapsed ? "w-[72px]" : "w-60"}`}>
        {nav(collapsed)}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3.5 top-7 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-line bg-white text-ink2 shadow-md hover:text-leaf"
          aria-label={collapsed ? "展開選單" : "收合選單"}
          title={collapsed ? "展開選單" : "收合選單"}
        >
          <Icon name={collapsed ? "chevronsRight" : "chevronsLeft"} size={16} />
        </button>
      </aside>

      {/* 手機、平板：抽屜 */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 bg-forest">
            <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-6 text-[#E8F0EB]" aria-label="關閉選單">
              <Icon name="x" size={22} />
            </button>
            {nav(false)}
          </aside>
        </div>
      )}

      <div className={`flex min-h-dvh flex-col transition-[padding] duration-200 ${collapsed ? "lg:pl-[96px]" : "lg:pl-[264px]"}`}>
        <header className="sticky top-0 z-20 flex h-14 flex-none items-center gap-3 border-b border-line bg-white/90 px-3 backdrop-blur lg:hidden">
          <button type="button" onClick={() => setOpen(true)} aria-label="開啟選單" className="flex h-11 w-11 items-center justify-center text-ink">
            <Icon name="menu" size={24} />
          </button>
          <span className="text-lg font-bold">周家農場 LINE 客服</span>
        </header>
        <PageGuard pathname={pathname}>{children}</PageGuard>
      </div>
    </div>
  );
}

/** 「頁面權限」沒開給這個帳號的頁面：不顯示內容，改列出看得到的頁面（資料 API 也會擋，這裡只是畫面） */
function PageGuard({ pathname, children }: { pathname: string; children: ReactNode }) {
  const me = useMe();
  const page = pageOfPath(pathname);
  if (!me || me.role === "admin" || !page || me.pages.includes(page)) return <>{children}</>;
  return (
    <main className="px-4 pt-10">
      <div className="mx-auto max-w-lg rounded-2xl border border-line bg-white p-8 text-center">
        <Icon name="lock" size={32} className="mx-auto text-mute" />
        <h1 className="mt-3 text-xl font-bold">你的帳號沒有權限查看「{pageLabel(page)}」</h1>
        <p className="mt-1 text-sm text-mute">需要這個頁面請聯絡管理者。</p>
        {me.pages.length > 0 ? (
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {me.pages.map((k) => (
              <Link key={k} href={pageHref(k)} className="rounded-lg bg-[#E6F2EB] px-3 py-1.5 text-sm font-bold text-leaf hover:bg-[#D6EADF]">
                {pageLabel(k)}
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-5 text-sm text-[#8A4B00]">目前沒有開放任何頁面給你的帳號。</p>
        )}
      </div>
    </main>
  );
}
