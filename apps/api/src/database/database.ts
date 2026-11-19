import { createRequire } from "node:module";
import { Inject, Injectable } from "@nestjs/common";
import type { ApiConfig } from "../config/env.js";
import { CONFIG } from "../config/tokens.js";

/** What the rest of the application may ask of the database in N2: is it reachable? Domain access arrives with the domain modules. */
export interface Database {
  ping(): Promise<void>;
  close(): Promise<void>;
}

// @prisma/client is CommonJS: load it with require so the named export resolves under native ESM. The client is generated from
// apps/web/prisma/schema.prisma (`pnpm db:generate`) into the shared package directory.
const { PrismaClient } = createRequire(import.meta.url)("@prisma/client") as typeof import("@prisma/client");

@Injectable()
export class PrismaDatabase implements Database {
  private readonly client: InstanceType<typeof PrismaClient>;

  constructor(@Inject(CONFIG) config: ApiConfig) {
    // lazy connection: constructing the client never touches the network, so start-up does not depend on the database
    this.client = new PrismaClient({ datasources: { db: { url: config.databaseUrl } }, log: [] });
  }

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
