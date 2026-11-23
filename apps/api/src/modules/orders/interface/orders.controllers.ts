import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import type { ApiConfig } from "../../../config/env.js";
import { CONFIG } from "../../../config/tokens.js";
import { SessionGuard } from "../../../auth/session.guard.js";
import { Audit, RequirePermission, StoreAccess, StoreAccessGuard, type StoreAccessContext } from "../../access/access.api.js";
import { shopperOf } from "../../checkout/checkout.api.js";
import { CustomerAuthService } from "../../customers/customers.api.js";
import { OrdersService } from "../application/orders.service.js";

/**
 * Placing and following orders on ONE published store (phase 3.4). Guests follow an order with the access token they got when placing it
 * (it is in the path: treat the URL as a secret link); signed-in customers by id. Nothing here is cacheable (personal data).
 * Posts are accepted from the platform's origins and from that store's own origin (OriginGuard: the checkout/ and customer/ routes).
 */
@Controller("public/stores/:label/checkout/orders")
export class PublicOrdersController {
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
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
}

/** A signed-in customer's orders in this store. Without a valid session of THIS store: 401. */
@Controller("public/stores/:label/customer/orders")
export class CustomerOrdersController {
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
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
}

/** The merchant's orders (phase 3.4). Orders carry the shopper's name, phone and address: owner and manager only. */
@Controller("stores/:storeId/orders")
@UseGuards(SessionGuard, StoreAccessGuard)
export class StoreOrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

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

  /** Confirm, ship, deliver or cancel (cancelling gives the stock back). */
  @Post(":orderId/status")
  @HttpCode(200)
  @RequirePermission("orders.manage")
  @Audit("order.status_changed", { type: "order", param: "orderId" })
  transition(@StoreAccess() a: StoreAccessContext, @Param("orderId") id: string, @Body() body: unknown) {
    return this.orders.transition(a, id, body);
  }
}
