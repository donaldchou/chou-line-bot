import { Suspense } from "react";
import { ChatView } from "./view";

export default function ChatPage() {
  return (
    <Suspense fallback={<p className="px-8 py-7 text-mute">載入中…</p>}>
      <ChatView />
    </Suspense>
  );
}
