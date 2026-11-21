import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, UseGuards } from "@nestjs/common";
import { SessionGuard } from "../../../auth/session.guard.js";
import { RequirePermission, StoreAccess, StoreAccessGuard, type StoreAccessContext } from "../../access/access.api.js";
import { SecretService } from "../application/secret.service.js";

/**
 * Store secrets (owner only: secrets.manage). Write-only from the outside: the list shows names, masked hints and dates; no route returns
 * a value (architecture guard). Changes are audited inside the service with the real actor.
 */
@Controller("stores/:storeId/secrets")
@UseGuards(SessionGuard, StoreAccessGuard)
export class SecretsController {
  constructor(@Inject(SecretService) private readonly secrets: SecretService) {}

  @Get()
  @RequirePermission("secrets.manage")
  list(@StoreAccess() a: StoreAccessContext) {
    return this.secrets.list(a);
  }

  @Put(":name")
  @HttpCode(204)
  @RequirePermission("secrets.manage")
  async set(@StoreAccess() a: StoreAccessContext, @Param("name") name: string, @Body() body: unknown): Promise<void> {
    await this.secrets.set(a, name, body);
  }

  @Post(":name/delete")
  @HttpCode(204)
  @RequirePermission("secrets.manage")
  async remove(@StoreAccess() a: StoreAccessContext, @Param("name") name: string): Promise<void> {
    await this.secrets.remove(a, name);
  }
}
