import { isAdmin, unauthorized } from "@/lib/admin-auth";
import { customerDetail } from "@/lib/admin-data";
import { ActionError, customerAction } from "@/lib/admin-actions";

export const maxDuration = 60;

const validId = (id: string) => /^U[0-9a-f]{32}$/.test(id);

export async function GET(req: Request, ctx: RouteContext<"/api/admin/customers/[id]">) {
  if (!(await isAdmin(req))) return unauthorized();
  const { id } = await ctx.params;
  if (!validId(id)) return Response.json({ error: "客戶編號不對" }, { status: 400 });
  const d = await customerDetail(id);
  if (!d) return Response.json({ error: "找不到這位客戶" }, { status: 404 });
  return Response.json(d);
}

export async function POST(req: Request, ctx: RouteContext<"/api/admin/customers/[id]">) {
  if (!(await isAdmin(req))) return unauthorized();
  const { id } = await ctx.params;
  if (!validId(id)) return Response.json({ error: "客戶編號不對" }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    return Response.json(await customerAction(id, body));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!(e instanceof ActionError)) console.error("customerAction", e);
    return Response.json({ error: e instanceof ActionError ? msg : `傳送失敗：${msg}` }, { status: e instanceof ActionError ? 400 : 502 });
  }
}
