import { InsightsService } from "../application/insights.service.js";
import { PrismaInsightsRepository } from "./prisma-insights.repository.js";

export const createInsightsService = (): InsightsService => new InsightsService(new PrismaInsightsRepository());
