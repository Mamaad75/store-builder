import { PublicReviewsService, StoreReviewsService } from "../application/reviews.service.js";
import { PrismaReviewsRepository } from "./prisma-reviews.repository.js";

export const createPublicReviewsService = (): PublicReviewsService => new PublicReviewsService(new PrismaReviewsRepository());
export const createStoreReviewsService = (): StoreReviewsService => new StoreReviewsService(new PrismaReviewsRepository());
