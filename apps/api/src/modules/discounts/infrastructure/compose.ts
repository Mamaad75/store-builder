import { DiscountsService } from "../application/discounts.service.js";
import { PrismaDiscountStore } from "./prisma-discounts.repository.js";

/** Composition (phase 5.1): the PostgreSQL discount store. */
export const createDiscountsService = (): DiscountsService => new DiscountsService(new PrismaDiscountStore());
