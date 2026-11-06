import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "周家農場 LINE 客服",
  description: "拉拉山周家農場 LINE 官方帳號 AI 客服機器人",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
