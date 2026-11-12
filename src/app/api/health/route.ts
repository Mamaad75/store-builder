export const dynamic = "force-dynamic";

import { platformOnly } from "@/lib/host-guard";

export function GET(req: Request) {
  return platformOnly(req) ?? Response.json({ status: "ok" });
}
