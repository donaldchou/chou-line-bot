import { isAdmin, unauthorized } from "@/lib/admin-auth";
import { customers } from "@/lib/admin-data";

export async function GET(req: Request) {
  if (!(await isAdmin(req))) return unauthorized();
  const p = new URL(req.url).searchParams;
  return Response.json(
    await customers({
      stage: p.get("stage") ?? undefined,
      sys: p.get("sys") ?? undefined,
      tag: p.get("tag") ?? undefined,
      search: p.get("q") ?? undefined,
      page: Number(p.get("page")) || 1,
    }),
  );
}
