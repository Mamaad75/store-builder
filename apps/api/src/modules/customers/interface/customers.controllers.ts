import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import type { ApiConfig } from "../../../config/env.js";
import { CONFIG } from "../../../config/tokens.js";
import { readCookie } from "../../../auth/cookie.js";
import { SessionGuard } from "../../../auth/session.guard.js";
import { RequirePermission, StoreAccess, StoreAccessGuard, type StoreAccessContext } from "../../access/access.api.js";
import { resolveLiveStore } from "../../publishing/publishing.api.js";
import { CustomerAuthService } from "../application/customer-auth.service.js";
import { CustomersService } from "../application/customers.service.js";
import { CUSTOMER_SESSION_SECONDS } from "../domain/otp.js";

const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * The customer cookie: host-only (no Domain) and __Host- prefixed over https (Path=/, Secure). It lives on whichever host serves these routes;
 * the storefront will serve them on the store's own host (docs/commerce.md, "Requirements before production" 3).
 */
export const customerCookieName = (c: Pick<ApiConfig, "secureCookies">) => (c.secureCookies ? "__Host-sb_customer" : "sb_customer");

/**
 * Shopper sign-in for ONE published store (phase 3.1, D31-2), addressed by its subdomain label. A store that is not live is the same 404
 * as a missing one. While SMS sign-in is off, the two code endpoints answer 503 (OtpUnavailableError) and `status` says so.
 */
@Controller("public/stores/:label/customer")
export class CustomerAuthController {
  constructor(
    @Inject(CustomerAuthService) private readonly auth: CustomerAuthService,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  private async storeId(label: string): Promise<string> {
    if (!LABEL_RE.test(label)) throw new NotFoundException();
    const live = await resolveLiveStore(label);
    if (!live) throw new NotFoundException();
    return live.storeId;
  }

  @Get("status")
  async status(@Param("label") label: string) {
    await this.storeId(label);
    return { otpEnabled: await this.auth.isEnabled() };
  }

  @Post("otp/request")
  @HttpCode(200)
  async request(@Param("label") label: string, @Body() body: { phone?: unknown } | undefined, @Req() req: Request) {
    return this.auth.requestCode(await this.storeId(label), body?.phone, req.ip ?? "unknown");
  }

  @Post("otp/verify")
  @HttpCode(200)
  async verify(@Param("label") label: string, @Body() body: { phone?: unknown; code?: unknown } | undefined, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { customer, token } = await this.auth.verifyCode(await this.storeId(label), body?.phone, body?.code, req.ip ?? "unknown");
    res.cookie(customerCookieName(this.config), token, { httpOnly: true, sameSite: "lax", secure: this.config.secureCookies, path: "/", maxAge: CUSTOMER_SESSION_SECONDS * 1000 });
    res.setHeader("Cache-Control", "no-store");
    return { customer };
  }

  @Get("me")
  async me(@Param("label") label: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    const customer = await this.auth.current(await this.storeId(label), readCookie(req.headers.cookie, customerCookieName(this.config)) ?? undefined);
    if (!customer) throw new UnauthorizedException();
    return { customer };
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Param("label") label: string, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.storeId(label);
    res.clearCookie(customerCookieName(this.config), { path: "/", secure: this.config.secureCookies, sameSite: "lax", httpOnly: true });
  }

  @Post("logout-all")
  @HttpCode(204)
  async logoutAll(@Param("label") label: string, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.signOutEverywhere(await this.storeId(label), readCookie(req.headers.cookie, customerCookieName(this.config)) ?? undefined);
    res.clearCookie(customerCookieName(this.config), { path: "/", secure: this.config.secureCookies, sameSite: "lax", httpOnly: true });
  }
}

/** The merchant's list of the store's customers (customers.view: owner and manager). */
@Controller("stores/:storeId/customers")
@UseGuards(SessionGuard, StoreAccessGuard)
export class StoreCustomersController {
  constructor(@Inject(CustomersService) private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission("customers.view")
  list(@StoreAccess() a: StoreAccessContext, @Query("before") before?: string, @Query("limit") limit?: string) {
    return this.customers.list(a, { before, limit });
  }
}
