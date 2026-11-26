import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
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
import { TransfersService } from "../application/transfers.service.js";
import { OverviewService } from "../application/overview.service.js";
import { SetupService } from "../application/setup.service.js";

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
    @Inject(TransfersService) private readonly transfers: TransfersService,
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
    const s = await shopperOf(req, this.config, this.auth, (await this.orders.orderStore(label)).storeId);
    return this.orders.cancelByToken(label, token, s);
  }

  /** Phase 3.5: a new Zarinpal session for an unpaid online order; answers the address to send the buyer to. */
  @Post(":token/pay")
  @HttpCode(200)
  async pay(@Param("label") label: string, @Param("token") token: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    const { storeId, orderId, availability } = await this.orders.orderIdByToken(label, token);
    this.orders.assertPrepaid(availability);
    const s = await shopperOf(req, this.config, this.auth, storeId);
    return withReturnKey(res, this.config, await this.payments.start(storeId, label, orderId, s.ipKey));
  }

  /**
   * D35b-1: a card-to-card receipt: the image is the raw body (application/octet-stream); the tracking number and the payer card's last 4
   * digits come in headers (review: never in the URL, which proxies and CDNs log).
   */
  @Post(":token/receipt")
  @HttpCode(204)
  async receipt(@Param("label") label: string, @Param("token") token: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    const { storeId, orderId, availability } = await this.orders.orderIdByToken(label, token);
    this.orders.assertPrepaid(availability);
    const s = await shopperOf(req, this.config, this.auth, storeId);
    await this.transfers.submit(storeId, orderId, req.body, receiptFields(req), s.ipKey);
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

/** D35b-1: the text fields of a receipt, from headers (percent-encoded so Persian digits survive). */
function receiptFields(req: Request): { trackingCode: unknown; payerCardLast4: unknown } {
  const one = (name: string) => {
    const v = req.headers[name];
    if (typeof v !== "string") return undefined;
    try {
      return decodeURIComponent(v);
    } catch {
      return "";
    }
  };
  return { trackingCode: one("x-receipt-tracking-code"), payerCardLast4: one("x-receipt-payer-last4") };
}

/** A signed-in customer's orders in this store. Without a valid session of THIS store: 401. */
@Controller("public/stores/:label/customer/orders")
export class CustomerOrdersController {
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(TransfersService) private readonly transfers: TransfersService,
    @Inject(CustomerAuthService) private readonly auth: CustomerAuthService,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  /** ADR 0003 (D1): a customer keeps their orders whatever the store's state. */
  private async who(label: string, req: Request, res: Response) {
    res.setHeader("Cache-Control", "no-store");
    const { storeId, availability } = await this.orders.orderStore(label);
    const s = await shopperOf(req, this.config, this.auth, storeId);
    if (!s.customerId) throw new UnauthorizedException();
    return { storeId, availability, customerId: s.customerId, verified: s.customerVerified === true, ipKey: s.ipKey };
  }

  @Get()
  async list(@Param("label") label: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const w = await this.who(label, req, res);
    return this.orders.listMine(w.storeId, w.customerId, w.verified, w.availability);
  }

  @Get(":orderId")
  async get(@Param("label") label: string, @Param("orderId") id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const w = await this.who(label, req, res);
    return this.orders.getMine(w.storeId, w.customerId, id, w.verified, w.availability);
  }

  @Post(":orderId/cancel")
  @HttpCode(200)
  async cancel(@Param("label") label: string, @Param("orderId") id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const w = await this.who(label, req, res);
    return this.orders.cancelMine(w.storeId, w.customerId, id, w.availability);
  }

  /** Phase 3.5: paying one of the customer's own unpaid online orders. */
  @Post(":orderId/pay")
  @HttpCode(200)
  async pay(@Param("label") label: string, @Param("orderId") id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const w = await this.who(label, req, res);
    this.orders.assertPrepaid(w.availability);
    return withReturnKey(res, this.config, await this.payments.start(w.storeId, label, await this.orders.ownOrderId(w.storeId, w.customerId, id), w.ipKey));
  }

  /** D35b-1: a card-to-card receipt for one of the customer's own orders (same body and query as the guest route). */
  @Post(":orderId/receipt")
  @HttpCode(204)
  async receipt(@Param("label") label: string, @Param("orderId") id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const w = await this.who(label, req, res);
    this.orders.assertPrepaid(w.availability);
    await this.transfers.submit(w.storeId, await this.orders.ownOrderId(w.storeId, w.customerId, id), req.body, receiptFields(req), w.ipKey);
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
    @Inject(TransfersService) private readonly transfers: TransfersService,
    @Inject(CustomerAuthService) private readonly auth: CustomerAuthService,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  @Get("payment-methods")
  async methods(@Param("label") label: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    const storeId = await this.orders.liveStoreId(label);
    const gateways = await this.payments.available(storeId);
    return { cod: true, online: gateways.length > 0, gateways, cardTransfer: await this.transfers.available(storeId) };
  }

  @Post("payments/verify")
  @HttpCode(200)
  async verify(@Param("label") label: string, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    // ADR 0003: a payment already started is always verified on return (the money may have moved), whatever the store's state now.
    const { storeId } = await this.orders.orderStore(label);
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
    @Inject(TransfersService) private readonly transfers: TransfersService,
  ) {}

  /** D35b-1: the order's card-to-card receipts (without the images). */
  @Get(":orderId/receipts")
  @RequirePermission("orders.view")
  receipts(@StoreAccess() a: StoreAccessContext, @Param("orderId") id: string) {
    return this.transfers.receipts(a, id);
  }

  /** D35b-1: one receipt image (re-encoded WebP), never cached and never a public link. */
  @Get(":orderId/receipts/:receiptId/image")
  @RequirePermission("orders.view")
  async receiptImage(@StoreAccess() a: StoreAccessContext, @Param("orderId") id: string, @Param("receiptId") rid: string, @Res() res: Response) {
    const img = await this.transfers.image(a, id, rid);
    res.setHeader("Content-Type", img.mime);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.end(img.bytes);
  }

  /** D35b-1: approve (the order is placed) or reject with a note (the shopper may send another receipt). */
  @Post(":orderId/receipts/:receiptId/review")
  @HttpCode(200)
  @RequirePermission("orders.manage")
  @Audit("order.receipt_reviewed", { type: "order", param: "orderId" })
  async review(@StoreAccess() a: StoreAccessContext, @Param("orderId") id: string, @Param("receiptId") rid: string, @Body() body: unknown) {
    const result = await this.transfers.review(a, id, rid, body);
    return { result, order: await this.orders.get(a, id) };
  }

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

  /**
   * The orders as a CSV file (the list's filters, optionally the last 7 / 30 / 90 days). Contains the shoppers' names, phones and addresses:
   * owner and manager only, audited. Declared BEFORE ":orderId" so "export" is not read as an order id.
   */
  @Get("export")
  @RequirePermission("orders.view")
  @Audit("order.exported")
  async export(@StoreAccess() a: StoreAccessContext, @Query() query: Record<string, string>, @Res({ passthrough: true }) res: Response): Promise<string> {
    const { csv } = await this.orders.exportCsv(a, query);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader("Cache-Control", "no-store");
    return csv;
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

  /** Set, change or clear (empty) the carrier's tracking code of a shipped order; the shopper sees it on their order page. */
  @Post(":orderId/tracking")
  @HttpCode(200)
  @RequirePermission("orders.manage")
  @Audit("order.tracking_set", { type: "order", param: "orderId" })
  tracking(@StoreAccess() a: StoreAccessContext, @Param("orderId") id: string, @Body() body: unknown) {
    return this.orders.setTracking(a, id, body);
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

/** D35b-1: the store's bank cards for card-to-card payment (shown to shoppers on their unpaid card-to-card orders). */
@Controller("stores/:storeId/bank-cards")
@UseGuards(SessionGuard, StoreAccessGuard)
export class StoreBankCardsController {
  constructor(@Inject(TransfersService) private readonly transfers: TransfersService) {}

  /** Every role may see the cards; only the owner sees full numbers (D-22). */
  @Get()
  @RequirePermission("store.view")
  list(@StoreAccess() a: StoreAccessContext) {
    return this.transfers.cards(a);
  }

  /** D-3 / V0-1: owner only; audited (before/after, masked) in the same transaction as the change, not after it. */
  @Put()
  @RequirePermission("payout.manage")
  replace(@StoreAccess() a: StoreAccessContext, @Body() body: unknown) {
    return this.transfers.replaceCards(a, body);
  }
}

/**
 * MVP item 3: the setup checklist (what is missing before shoppers can finish an order). Read-only; `store.settings` (owner and manager:
 * the roles that can fix the items). Allowed while suspended (GET).
 */
@Controller("stores/:storeId/setup")
@UseGuards(SessionGuard, StoreAccessGuard)
export class StoreSetupController {
  constructor(@Inject(SetupService) private readonly setup: SetupService) {}

  @Get()
  @RequirePermission("store.settings")
  checklist(@StoreAccess() a: StoreAccessContext) {
    return this.setup.checklist(a);
  }
}

/**
 * M2: the store overview (order value, paid revenue, pending payments, action items, low stock). Read-only; `orders.view` (owner and
 * manager; an operator is refused). Allowed while the store is suspended (GET), like the order list.
 */
@Controller("stores/:storeId/overview")
@UseGuards(SessionGuard, StoreAccessGuard)
export class StoreOverviewController {
  constructor(@Inject(OverviewService) private readonly overviews: OverviewService) {}

  @Get()
  @RequirePermission("orders.view")
  overview(@StoreAccess() a: StoreAccessContext) {
    return this.overviews.overview(a);
  }
}
