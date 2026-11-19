import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { ApiConfig } from "../config/env.js";
import { CONFIG } from "../config/tokens.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for the REST API (ADR 0001): Server Actions checked the Origin for us; here every state-changing request must carry an
 * `Origin` header that is exactly one of the platform's own origins. Missing, `null` or foreign origins are refused with 403, and a
 * browser that says `Sec-Fetch-Site: cross-site` is refused even if the Origin matched. Cookies are additionally SameSite=Lax (N3).
 * Non-browser clients (no Origin) get no cookie-based access; token-based machine clients are a later, explicit decision.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: ReadonlySet<string>;

  constructor(@Inject(CONFIG) config: ApiConfig) {
    this.allowed = new Set(config.allowedOrigins);
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method.toUpperCase())) return true;
    const origin = req.headers.origin;
    const site = req.headers["sec-fetch-site"];
    if (typeof origin !== "string" || !this.allowed.has(origin) || site === "cross-site") throw new ForbiddenException();
    return true;
  }
}
