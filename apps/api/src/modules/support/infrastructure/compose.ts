import { StaffSupportService, SupportService } from "../application/support.service.js";
import { PrismaSupportRepository } from "./prisma-support.repository.js";

export const createSupportService = (): SupportService => new SupportService(new PrismaSupportRepository());
export const createStaffSupportService = (): StaffSupportService => new StaffSupportService(new PrismaSupportRepository());
