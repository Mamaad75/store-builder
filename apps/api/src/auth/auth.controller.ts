import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import type { ApiConfig } from "../config/env.js";
import { CONFIG } from "../config/tokens.js";
import { ApiProblem } from "../http/api-problem.js";
import { AuthService } from "./auth.service.js";
import { sessionCookieName, sessionCookieOptions } from "./cookie.js";
import { type AuthedRequest, SessionGuard } from "./session.guard.js";

/** REST surface of authentication (ADR 0001, N3). Every response is `no-store` (set for the whole prefix in app.ts). */
@Controller("auth")
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  private clear(res: Response): void {
    res.clearCookie(sessionCookieName(this.config), sessionCookieOptions(this.config));
  }

  @Post("register")
  @HttpCode(201)
  async register(@Body() body: unknown, @Req() req: Request) {
    const r = await this.auth.register(body, { ip: req.ip ?? "unknown" });
    if (r.ok) return { ok: true };
    if (r.error === "rate_limited") throw new ApiProblem(429, { code: "rate_limited", retryAfterSeconds: r.retryAfterSeconds });
    if (r.error === "username_taken") throw new ApiProblem(409, { code: "username_taken", fieldErrors: r.fieldErrors });
    throw new ApiProblem(400, { code: "invalid", fieldErrors: r.fieldErrors });
  }

  /** MVP item 2: whether sign-up needs an invitation code. Public; reveals nothing else. */
  @Get("registration")
  async registration() {
    return { mode: await this.auth.registrationMode() };
  }

  /** MVP item 2: set a new password with a recovery link issued by platform support (single use, 24 h). */
  @Post("recover")
  @HttpCode(204)
  async recover(@Body() body: unknown, @Req() req: Request): Promise<void> {
    const r = await this.auth.recover(body, { ip: req.ip ?? "unknown" });
    if (r.ok) return;
    if (r.error === "rate_limited") throw new ApiProblem(429, { code: "rate_limited", retryAfterSeconds: r.retryAfterSeconds });
    throw new ApiProblem(400, { code: "invalid", fieldErrors: r.fieldErrors });
  }

  @Post("login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(body, { ip: req.ip ?? "unknown" });
    if (!r.ok) {
      if (r.reason === "rate_limited") throw new ApiProblem(429, { code: "rate_limited", retryAfterSeconds: r.retryAfterSeconds });
      throw new ApiProblem(401, { code: "invalid_credentials" });
    }
    res.cookie(sessionCookieName(this.config), r.token, { ...sessionCookieOptions(this.config), maxAge: this.config.sessionMaxAgeSeconds * 1000 });
    return { user: r.user };
  }

  /** Stateless tokens: signing out clears the cookie. Revoking tokens already issued is `logout-all`. */
  @Post("logout")
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response): void {
    this.clear(res);
  }

  @Get("me")
  @UseGuards(SessionGuard)
  me(@Req() req: Request) {
    return { user: (req as AuthedRequest).sessionUser };
  }

  /** MVP item 2: notices for the signed-in user (a recent account recovery by platform support). */
  @Get("notices")
  @UseGuards(SessionGuard)
  notices(@Req() req: Request) {
    return this.auth.notices((req as AuthedRequest).sessionUser.id);
  }

  @Post("change-password")
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async changePassword(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const r = await this.auth.changePassword((req as AuthedRequest).sessionUser.id, body);
    if (!r.ok) {
      if (r.error === "rate_limited") throw new ApiProblem(429, { code: "rate_limited", retryAfterSeconds: r.retryAfterSeconds });
      throw new ApiProblem(400, { code: r.error, fieldErrors: r.fieldErrors });
    }
    this.clear(res);
  }

  @Post("logout-all")
  @HttpCode(204)
  @UseGuards(SessionGuard)
  async logoutAll(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.signOutEverywhere((req as AuthedRequest).sessionUser.id);
    this.clear(res);
  }
}
