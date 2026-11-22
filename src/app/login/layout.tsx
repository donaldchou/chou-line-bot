import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LINE 客服後台｜CHOU 農場平台",
  robots: { index: false, follow: false },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
