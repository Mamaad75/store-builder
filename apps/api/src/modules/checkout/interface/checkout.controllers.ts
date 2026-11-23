import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Req, Res, UnauthorizedException, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { CART_TTL_DAYS } from "@store-builder/shared/modules/checkout/checkout";
import type { ApiConfig } from "../../../config/env.js";
import { CONFIG } from "../../../config/tokens.js";
import { SessionGuard } from "../../../auth/session.guard.js";
import { Audit, RequirePermission, StoreAccess, StoreAccessGuard, type StoreAccessContext } from "../../access/access.api.js";
import { CustomerAuthService } from "../../customers/customers.api.js";
import { CheckoutService, type Shopper } from "../application/checkout.service.js";
import { cartCookieName, shopperOf } from "./shopper.js";
import { ShippingService } from "../application/shipping.service.js";

/**
 * The shopper's cart and checkout summary for ONE published store (phase 3.3, D33-1), addressed by its subdomain label. A store that is not
 * live is the same 404 as a missing one. Posts are accepted from the platform's origins and from that store's own origin (OriginGuard).
 * Nothing here is cached by browsers or proxies (personal data, changing prices).
 */
@Controller("public/stores/:label")
export class PublicCheckoutController {
  constructor(
    @Inject(CheckoutService) private readonly checkout: CheckoutService,
    @Inject(CustomerAuthService) private readonly auth: CustomerAuthService,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  private async shopper(label: string, req: Request): Promise<Shopper> {
    return shopperOf(req, this.config, this.auth, await this.checkout.liveStoreId(label));
  }

  private setCart(res: Response, token: string | null) {
    res.setHeader("Cache-Control", "no-store");
    if (token) res.cookie(cartCookieName(this.config), token, { httpOnly: true, sameSite: "lax", secure: this.config.secureCookies, path: "/", maxAge: CART_TTL_DAYS * 86_400_000 });
  }

  @Get("cart")
  async cart(@Param("label") label: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.setCart(res, null);
    return this.checkout.getCart(label, await this.shopper(label, req));
  }

  /** Adds to a line (creates the cart, and its cookie, on the first add). */
  @Post("cart/items")
  @HttpCode(200)
  async add(@Param("label") label: string, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.checkout.setLine(label, await this.shopper(label, req), body, "add");
    this.setCart(res, r.newCartToken);
    return r.result;
  }

  /** Sets a line's quantity; 0 removes it. */
  @Put("cart/items")
  async set(@Param("label") label: string, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.checkout.setLine(label, await this.shopper(label, req), body, "set");
    this.setCart(res, r.newCartToken);
    return r.result;
  }

  @Delete("cart")
  @HttpCode(204)
  async clear(@Param("label") label: string, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    this.setCart(res, null);
    await this.checkout.clearCart(label, await this.shopper(label, req));
  }

  /** The checkout summary for an address and a shipping choice. Read-only (a POST because the address is personal data: never in a URL). */
  @Post("checkout/quote")
  @HttpCode(200)
  async quote(@Param("label") label: string, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.setCart(res, null);
    return this.checkout.quote(label, await this.shopper(label, req), body);
  }
}

/** A signed-in customer's saved addresses in this store. Without a valid session of THIS store: 401. */
@Controller("public/stores/:label/customer/addresses")
export class CustomerAddressesController {
  constructor(
    @Inject(CheckoutService) private readonly checkout: CheckoutService,
    @Inject(CustomerAuthService) private readonly auth: CustomerAuthService,
    @Inject(CONFIG) private readonly config: ApiConfig,
  ) {}

  private async who(label: string, req: Request, res: Response): Promise<{ storeId: string; customerId: string }> {
    res.setHeader("Cache-Control", "no-store");
    const storeId = await this.checkout.liveStoreId(label);
    const s = await shopperOf(req, this.config, this.auth, storeId);
    if (!s.customerId) throw new UnauthorizedException();
    return { storeId, customerId: s.customerId };
  }

  @Get()
  async list(@Param("label") label: string, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const w = await this.who(label, req, res);
    return this.checkout.listAddresses(w.storeId, w.customerId);
  }

  @Post()
  async create(@Param("label") label: string, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const w = await this.who(label, req, res);
    return this.checkout.createAddress(w.storeId, w.customerId, body);
  }

  @Put(":addressId")
  async update(@Param("label") label: string, @Param("addressId") id: string, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const w = await this.who(label, req, res);
    return this.checkout.updateAddress(w.storeId, w.customerId, id, body);
  }

  @Delete(":addressId")
  @HttpCode(204)
  async remove(@Param("label") label: string, @Param("addressId") id: string, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const w = await this.who(label, req, res);
    await this.checkout.deleteAddress(w.storeId, w.customerId, id);
  }
}

/** The merchant's shipping methods (phase 3.3). Reading needs store.view; changing them is a store setting (owner and manager), audited. */
@Controller("stores/:storeId/shipping-methods")
@UseGuards(SessionGuard, StoreAccessGuard)
export class ShippingMethodsController {
  constructor(@Inject(ShippingService) private readonly shipping: ShippingService) {}

  @Get()
  @RequirePermission("store.view")
  list(@StoreAccess() a: StoreAccessContext) {
    return this.shipping.list(a);
  }

  /** Replaces the whole list; it applies to checkout at once (no publish). */
  @Put()
  @RequirePermission("store.settings")
  @Audit("store.shipping_methods_replaced")
  replace(@StoreAccess() a: StoreAccessContext, @Body() body: unknown) {
    return this.shipping.replace(a, body);
  }
}
