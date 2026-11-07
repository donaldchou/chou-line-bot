import { customers } from "@/lib/admin-data";
import { handleError, requirePage } from "@/lib/auth";

export async function GET(req: Request) {
  try {
    // 對話頁的左邊列表也用這支
    await requirePage(req, "customers", "chat");
    const p = new URL(req.url).searchParams;
    return Response.json(
      await customers({
        stage: p.get("stage") ?? undefined,
        sys: p.get("sys") ?? undefined,
        tag: p.get("tag") ?? undefined,
        seg: p.get("seg") ?? undefined,
        search: p.get("q") ?? undefined,
        page: Number(p.get("page")) || 1,
      }),
    );
  } catch (err) {
    return handleError(err);
  }
}
