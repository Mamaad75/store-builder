import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { ApiConfig } from "../config/env.js";
import { CONFIG } from "../config/tokens.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Shopper routes a store's own origin may post to: sign-in and saved addresses (3.1), the cart and the checkout summary (3.3), and the page-view beacon. Nothing else. */
const CUSTOMER_ROUTE = /^\/api\/public\/stores\/[a-z0-9-]+\/(?:customer\/|cart(?:\/|$)|checkout\/|visit$)/;

/**
 * CSRF defence for the REST API (ADR 0001): Server Actions checked the Origin for us; here every state-changing request must carry an
 * `Origin` header that is exactly one of the platform's own origins. Missing, `null` or foreign origins are refused with 403, and a
 * browser that says `Sec-Fetch-Site: cross-site` is refused even if the Origin matched. Cookies are additionally SameSite=Lax (N3).
 * Non-browser clients (no Origin) get no cookie-based access; token-based machine clients are a later, explicit decision.
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowed: ReadonlySet<string>;
  private readonly storeOrigin: (label: string) => string;

  constructor(@Inject(CONFIG) config: ApiConfig) {
    this.allowed = new Set(config.allowedOrigins);
    this.storeOrigin = (label) => `${config.protocol}://${label}.${config.rootDomain}`;
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method.toUpperCase())) return true;
    const origin = req.headers.origin;
    const site = req.headers["sec-fetch-site"];
    if (typeof origin !== "string" || site === "cross-site") throw new ForbiddenException();
    if (this.allowed.has(origin)) return true;
    // Phases 3.1/3.3: shopper routes are posted from the store's OWN host. Only those routes, and only that exact store's origin.
    const label = (req.params as Record<string, string> | undefined)?.label;
    if (label && CUSTOMER_ROUTE.test(req.path) && origin === this.storeOrigin(label)) return true;
    throw new ForbiddenException();
  }
}
