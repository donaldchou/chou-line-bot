"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { api } from "./ui";

const Icon = {
  home: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  users: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21c0-4 3-6 7-6s7 2 7 6" />
      <path d="M16 4a4 4 0 0 1 0 8M22 21c0-3-2-5-4-5.6" />
    </svg>
  ),
  chat: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-6.4A8 8 0 1 1 21 12z" />
    </svg>
  ),
  box: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 7l9-4 9 4v10l-9 4-9-4z" />
      <path d="M3 7l9 4 9-4M12 11v10" />
    </svg>
  ),
};

const NAV = [
  { href: "/admin", label: "總覽", icon: Icon.home },
  { href: "/admin/customers", label: "客戶", icon: Icon.users },
  { href: "/admin/chat", label: "對話", icon: Icon.chat },
  { href: "/admin/orders", label: "LINE 訂單", short: "訂單", icon: Icon.box },
];

export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const on = (href: string) => (href === "/admin" ? path === "/admin" : path.startsWith(href));
  const logout = async () => {
    await api("/api/admin/login", { method: "DELETE" }).catch(() => {});
    router.push("/login");
  };

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* 電腦版：左側選單 */}
      <nav aria-label="主選單" className="hidden w-[232px] flex-none flex-col gap-1 bg-forest px-4 py-6 text-[#E8F0EB] md:flex">
        <div className="flex items-center gap-2.5 px-2 pb-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-linegreen text-[15px] font-bold text-white">周</div>
          <div className="flex flex-col">
            <span className="text-base font-bold text-white">周家農場</span>
            <span className="text-xs text-[#A9C4B6]">LINE 客服後台</span>
          </div>
        </div>
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={on(n.href) ? "page" : undefined}
            className={`flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-[15px] ${on(n.href) ? "bg-forest3 font-bold text-white" : "text-[#CFE0D6] hover:bg-forest2 hover:text-white"}`}
          >
            {n.icon}
            {n.label}
          </Link>
        ))}
        <button type="button" onClick={logout} className="mt-auto min-h-11 rounded-lg px-3 text-left text-sm text-[#A9C4B6] hover:bg-forest2 hover:text-white">
          登出
        </button>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col pb-[60px] md:pb-0">{children}</div>

      {/* 手機版：底部選單 */}
      <nav aria-label="主選單" className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-line bg-white md:hidden">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-current={on(n.href) ? "page" : undefined}
            className={`flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-xs ${on(n.href) ? "font-bold text-leaf" : "text-ink2"}`}
          >
            {n.icon}
            {n.short ?? n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
