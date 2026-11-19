import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import type { ApiConfig } from "../config/env.js";
import { CONFIG } from "../config/tokens.js";
import { ApiProblem } from "../http/api-problem.js";
import { AuthService } from "./auth.service.js";
import { readCookie, sessionCookieName } from "./cookie.js";
import type { SafeUser } from "./ports.js";

export type AuthedRequest = Request & { sessionUser: SafeUser };

/** Requires a valid session cookie whose token is still current (user exists, authVersion matches). Anything else is 401. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = readCookie(req.headers.cookie, sessionCookieName(this.config));
    const user = token ? await this.auth.userForToken(token) : null;
    if (!user) throw new ApiProblem(401, { code: "unauthenticated" });
    (req as AuthedRequest).sessionUser = user;
    return true;
  }
}
