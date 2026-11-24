import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import type { ApiConfig } from "../../../config/env.js";
import { CONFIG } from "../../../config/tokens.js";
import { SessionGuard } from "../../../auth/session.guard.js";
import { Audit, RequirePermission, StoreAccess, StoreAccessGuard, type StoreAccessContext } from "../../access/access.api.js";
import { shopperOf } from "../../checkout/checkout.api.js";
import { readCookie } from "../../../auth/cookie.js";
import { CustomerAuthService } from "../../customers/customers.api.js";
import { OrdersService } from "../application/orders.service.js";
import { PaymentsService } from "../application/payments.service.js";

/**
 * Placing and following orders on ONE published store (phase 3.4). Guests follow an order with the access token they got when placing it
 * (it is in the path: treat the URL as a secret link); signed-in customers by id. Nothing here is cacheable (personal data).
 * Posts are accepted from the platform's origins and from that store's own origin (OriginGuard: the checkout/ and customer/ routes).
 */
@Controller("public/stores/:label/checkout/orders")
export class PublicOrdersController {
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(CustomerAuthService) private readonly auth: CustomerAuthService,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  @Post()
  async place(@Param("label") label: string, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    const s = await shopperOf(req, this.config, this.auth, await this.orders.liveStoreId(label));
    return this.orders.place(label, s, body);
  }

  @Get(":token")
  async get(@Param("label") label: string, @Param("token") token: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    return this.orders.getByToken(label, token);
  }

  @Post(":token/cancel")
  @HttpCode(200)
  async cancel(@Param("label") label: string, @Param("token") token: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    const s = await shopperOf(req, this.config, this.auth, await this.orders.liveStoreId(label));
    return this.orders.cancelByToken(label, token, s);
  }

  /** Phase 3.5: a new Zarinpal session for an unpaid online order; answers the address to send the buyer to. */
  @Post(":token/pay")
  @HttpCode(200)
  async pay(@Param("label") label: string, @Param("token") token: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    const { storeId, orderId } = await this.orders.orderIdByToken(label, token);
    const s = await shopperOf(req, this.config, this.auth, storeId);
    return withReturnKey(res, this.config, await this.payments.start(storeId, label, orderId, s.ipKey));
  }
}

/**
 * Phase 3.5 (review): the browser that opened a payment session gets its return key as an HttpOnly cookie on the store's own host; only
 * that browser gets the order link back from the return (the authority in the return URL is not a secret). The key is not in the answer.
 */
const payCookieName = (c: Pick<ApiConfig, "secureCookies">) => (c.secureCookies ? "__Host-sb_pay" : "sb_pay");
function withReturnKey(res: Response, config: ApiConfig, r: { url: string; returnKey: string }): { url: string } {
  res.cookie(payCookieName(config), r.returnKey, { httpOnly: true, sameSite: "lax", secure: config.secureCookies, path: "/", maxAge: 2 * 3600_000 });
  return { url: r.url };
}

/** A signed-in customer's orders in this store. Without a valid session of THIS store: 401. */
@Controller("public/stores/:label/customer/orders")
export class CustomerOrdersController {
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(CustomerAuthService) private readonly auth: CustomerAuthService,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  private async who(label: string, req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");
    const storeId = await this.orders.liveStoreId(label);
    const s = await shopperOf(req, this.config, this.auth, storeId);
    if (!s.customerId) throw new UnauthorizedException();
    return { storeId, customerId: s.customerId, verified: s.customerVerified === true };
  }

  @Get()
  async list(@Param("label") label: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const w = await this.who(label, req, res);
    return this.orders.listMine(w.storeId, w.customerId, w.verified);
  }

  @Get(":orderId")
  async get(@Param("label") label: string, @Param("orderId") id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const w = await this.who(label, req, res);
    return this.orders.getMine(w.storeId, w.customerId, id, w.verified);
  }

  @Post(":orderId/cancel")
  @HttpCode(200)
  async cancel(@Param("label") label: string, @Param("orderId") id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const w = await this.who(label, req, res);
    return this.orders.cancelMine(w.storeId, w.customerId, id);
  }

  /** Phase 3.5: paying one of the customer's own unpaid online orders. */
  @Post(":orderId/pay")
  @HttpCode(200)
  async pay(@Param("label") label: string, @Param("orderId") id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    const storeId = await this.orders.liveStoreId(label);
    const s = await shopperOf(req, this.config, this.auth, storeId);
    if (!s.customerId) throw new UnauthorizedException();
    return withReturnKey(res, this.config, await this.payments.start(storeId, label, await this.orders.ownOrderId(storeId, s.customerId, id), s.ipKey));
  }
}

/**
 * Phase 3.5 (D35-1): which payment methods the store takes, and the buyer's return from Zarinpal. The return carries only the gateway's
 * Authority and Status; the payment is settled by a server-side verify with the amount stored when the session was opened.
 */
@Controller("public/stores/:label/checkout")
export class PaymentsController {
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(CustomerAuthService) private readonly auth: CustomerAuthService,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  @Get("payment-methods")
  async methods(@Param("label") label: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    return { cod: true, online: await this.payments.available(await this.orders.liveStoreId(label)) };
  }

  @Post("payments/verify")
  @HttpCode(200)
  async verify(@Param("label") label: string, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    const storeId = await this.orders.liveStoreId(label);
    const s = await shopperOf(req, this.config, this.auth, storeId);
    const r = await this.payments.verifyReturn(storeId, body, { ipKey: s.ipKey, returnKey: readCookie(req.headers.cookie, payCookieName(this.config)) ?? null, customerId: s.customerId });
    res.setHeader("Referrer-Policy", "no-referrer");
    return r;
  }
}

/** The merchant's orders (phase 3.4). Orders carry the shopper's name, phone and address: owner and manager only. */
@Controller("stores/:storeId/orders")
@UseGuards(SessionGuard, StoreAccessGuard)
export class StoreOrdersController {
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(PaymentsService) private readonly paymentsSvc: PaymentsService,
  ) {}

  @Get()
  @RequirePermission("orders.view")
  list(@StoreAccess() a: StoreAccessContext, @Query() query: Record<string, string>) {
    return this.orders.list(a, query);
  }

  /** Phase 3.3b: order count, spending and last order of up to 100 customers (`?ids=a,b`). */
  @Get("customer-stats")
  @RequirePermission("customers.view")
  customerStats(@StoreAccess() a: StoreAccessContext, @Query("ids") ids?: string) {
    return this.orders.customerStats(a, ids);
  }

  @Get(":orderId")
  @RequirePermission("orders.view")
  get(@StoreAccess() a: StoreAccessContext, @Param("orderId") id: string) {
    return this.orders.get(a, id);
  }

  /** Phase 3.5: the order's online payment attempts (status, reference number, masked card). */
  @Get(":orderId/payments")
  @RequirePermission("orders.view")
  async payments(@StoreAccess() a: StoreAccessContext, @Param("orderId") id: string) {
    await this.orders.get(a, id); // 404 for an order of another store
    return this.paymentsSvc.attempts(a.storeId, id);
  }

  /** Confirm, ship, deliver or cancel (cancelling gives the stock back). */
  @Post(":orderId/status")
  @HttpCode(200)
  @RequirePermission("orders.manage")
  @Audit("order.status_changed", { type: "order", param: "orderId" })
  transition(@StoreAccess() a: StoreAccessContext, @Param("orderId") id: string, @Body() body: unknown) {
    return this.orders.transition(a, id, body);
  }
}

/**
 * Phase 3.5: the store's online-payment state for its settings page (the merchant id itself is set through the secrets API, write-only,
 * as the secret "payment.zarinpal.merchant_id"). Owner and manager only, like the secrets.
 */
@Controller("stores/:storeId/payment-settings")
@UseGuards(SessionGuard, StoreAccessGuard)
export class StorePaymentSettingsController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

  @Get()
  @RequirePermission("secrets.manage")
  view(@StoreAccess() a: StoreAccessContext) {
    return this.payments.settingsView(a.storeId);
  }
}
