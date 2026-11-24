import { type CallHandler, type CanActivate, type ExecutionContext, Inject, Injectable, type NestInterceptor, SetMetadata, createParamDecorator } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Permission } from "@store-builder/shared/modules/access/permissions";
import { type Observable, tap } from "rxjs";
import type { AuthedRequest } from "../../../auth/session.guard.js";
import { LOGGER } from "../../../config/tokens.js";
import { ApiProblem } from "../../../http/api-problem.js";
import type { JsonLogger } from "../../../logging/json-logger.js";
import { AccessService } from "../application/access.service.js";
import type { StoreAccessContext } from "../application/ports.js";

export const PERMISSION_KEY = "store-permission";
const AUDIT_KEY = "store-audit";

export type StoreAccessRequest = AuthedRequest & { storeAccess?: StoreAccessContext };

/** The permission a `:storeId` route needs (D23-1). Every such route must declare one (architecture guard). */
export const RequirePermission = (permission: Permission) => SetMetadata(PERMISSION_KEY, permission);

/** Records a successful call in the audit log (D23-3) with the real actor; `target` names the route param that identifies the target. */
export const Audit = (action: string, target?: { type: string; param: string }) => SetMetadata(AUDIT_KEY, { action, target });

/** The resolved access of this request (set by StoreAccessGuard). Services receive `ownerId`; the audit uses `actorId`. */
export const StoreAccess = createParamDecorator((_d: unknown, ctx: ExecutionContext): StoreAccessContext => {
  const a = ctx.switchToHttp().getRequest<StoreAccessRequest>().storeAccess;
  if (!a) throw new Error("StoreAccess used on a route without StoreAccessGuard");
  return a;
});

/**
 * Resolves the session user's role in the route's store and checks the route's permission, in SQL, once per request. Runs AFTER
 * SessionGuard. No role = NotFoundError (404, same as a missing store); a role without the permission = PermissionDeniedError (403).
 */
@Injectable()
export class StoreAccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AccessService) private readonly access: AccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.get<Permission | undefined>(PERMISSION_KEY, ctx.getHandler());
    if (!permission) throw new Error(`route ${ctx.getClass().name}.${ctx.getHandler().name} has no @RequirePermission`); // fail closed
    const req = ctx.switchToHttp().getRequest<StoreAccessRequest>();
    if (!req.sessionUser) throw new ApiProblem(401, { code: "unauthenticated" });
    const write = req.method !== "GET" && req.method !== "HEAD";
    req.storeAccess = await this.access.resolve(req.sessionUser.id, req.params.storeId, permission, write);
    return true;
  }
}

/** Writes the audit entry after the handler SUCCEEDED. A failed write never fails the request, but is logged as an error. */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AccessService) private readonly access: AccessService,
    @Inject(LOGGER) private readonly logger: JsonLogger,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<{ action: string; target?: { type: string; param: string } } | undefined>(AUDIT_KEY, ctx.getHandler());
    if (!meta) return next.handle();
    const req = ctx.switchToHttp().getRequest<StoreAccessRequest>();
    return next.handle().pipe(
      tap(() => {
        const a = req.storeAccess;
        const targetId = meta.target ? req.params[meta.target.param] : undefined;
        this.access
          .record({ storeId: a?.storeId ?? null, actorId: a?.actorId ?? req.sessionUser?.id ?? null, action: meta.action, targetType: meta.target?.type, targetId: typeof targetId === "string" ? targetId : undefined, metadata: a ? { role: a.role } : undefined })
          .catch((e: unknown) => this.logger.event("error", "audit.write_failed", { action: meta.action, errorClass: e instanceof Error ? e.name : "UnknownError" }));
      }),
    );
  }
}
