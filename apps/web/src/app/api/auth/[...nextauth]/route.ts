import { handlers } from "@/auth";
import { platformOnly } from "@/lib/host-guard";

// Authentication is platform-only: a store host never reaches it (the proxy already answers 404; this is the second line).
export const GET = (req: Request) => platformOnly(req) ?? handlers.GET(req as never);
export const POST = (req: Request) => platformOnly(req) ?? handlers.POST(req as never);
