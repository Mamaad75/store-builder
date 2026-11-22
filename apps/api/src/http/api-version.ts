import type { NextFunction, Request, Response } from "express";
import { handlerPathOf, isV1Path, v1PathOf } from "@store-builder/shared/api/routing";

/**
 * Versioned paths (phase 2.5, D25-1). A `/api/v1/<scope>/...` request is rewritten to its handler path BEFORE routing, so v1 and the
 * deprecated unversioned paths share one implementation, one set of guards and one rate limiter; the request remembers that it came in
 * through v1 (error shape, keyset pages). A v1 path that maps to nothing (unknown scope, the reserved `platform`) is left as it is and
 * answers 404 in the v1 shape. Unversioned product paths answer as before, with a `Deprecation` header naming the successor.
 */
export function apiVersionMiddleware(req: Request, res: Response, next: NextFunction): void {
  const q = req.url.indexOf("?");
  const pathname = q === -1 ? req.url : req.url.slice(0, q);
  if (isV1Path(pathname)) {
    res.locals.apiVersion = 1;
    const handler = handlerPathOf(pathname);
    if (handler) req.url = handler + (q === -1 ? "" : req.url.slice(q));
  } else {
    const successor = v1PathOf(pathname);
    if (successor) {
      res.setHeader("Deprecation", "true");
      // The successor echoes the request path: only plain path characters go into the header (security review 2026-11-22).
      if (/^[A-Za-z0-9\-._~/%:@]+$/.test(successor)) res.setHeader("Link", `<${successor}>; rel="successor-version"`);
    }
  }
  next();
}

/** True when the request came in through /api/v1. */
export const isV1 = (res: Response | undefined): boolean => res?.locals?.apiVersion === 1;
