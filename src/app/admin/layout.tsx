import type { Metadata } from "next";
import { Shell } from "./_ui/shell";

export const metadata: Metadata = {
  title: "LINE 客服後台｜周家農場",
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <Shell>{children}</Shell>;
}
