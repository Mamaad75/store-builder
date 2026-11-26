import { Module } from "@nestjs/common";
import { StaffSupportService, SupportService } from "./application/support.service.js";
import { createStaffSupportService, createSupportService } from "./infrastructure/compose.js";
import { PlatformTicketsController } from "./interface/platform-tickets.controller.js";
import { StoreTicketsController } from "./interface/support.controllers.js";

/** Support requests (tickets) from stores to the platform staff. PlatformAdminGuard's PlatformService comes from the global PlatformModule. */
@Module({
  controllers: [StoreTicketsController, PlatformTicketsController],
  providers: [
    { provide: SupportService, useFactory: createSupportService },
    { provide: StaffSupportService, useFactory: createStaffSupportService },
  ],
})
export class SupportModule {}
