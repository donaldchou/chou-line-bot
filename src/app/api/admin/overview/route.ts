import { isAdmin, unauthorized } from "@/lib/admin-auth";
import { overview } from "@/lib/admin-data";

export const maxDuration = 60;

export async function GET(req: Request) {
  if (!(await isAdmin(req))) return unauthorized();
  return Response.json(await overview());
}
