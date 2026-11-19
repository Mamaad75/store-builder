import { Inject, Injectable } from "@nestjs/common";
import { PRISMA_CLIENT } from "../config/tokens.js";
import type { Prisma } from "./prisma-client.js";

/** What the health probe asks of the database: is it reachable? Domain access goes through the repositories. */
export interface Database {
  ping(): Promise<void>;
  close(): Promise<void>;
}

@Injectable()
export class PrismaDatabase implements Database {
  constructor(@Inject(PRISMA_CLIENT) private readonly client: Prisma) {}

  async ping(): Promise<void> {
    await this.client.$queryRaw`SELECT 1`;
  }

  async close(): Promise<void> {
    await this.client.$disconnect();
  }

  /** Nest calls this on shutdown (enableShutdownHooks). */
  async onModuleDestroy(): Promise<void> {
    await this.close();
  }
}
