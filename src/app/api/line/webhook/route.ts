import { after } from "next/server";
import { verifySignature } from "@/lib/line";
import { handleEvent } from "@/lib/bot";

export const maxDuration = 60;

/** LINE webhook：驗證簽章後立刻回 200，事件在背景處理（AI 回覆需要幾秒） */
export async function POST(req: Request) {
  const body = await req.text();
  if (!verifySignature(body, req.headers.get("x-line-signature"))) {
    return Response.json({ error: "bad signature" }, { status: 401 });
  }
  const events: Record<string, unknown>[] = JSON.parse(body).events ?? [];
  after(async () => {
    for (const ev of events) {
      try {
        await handleEvent(ev);
      } catch (e) {
        console.error("webhook event", e);
      }
    }
  });
  return Response.json({ ok: true });
}
