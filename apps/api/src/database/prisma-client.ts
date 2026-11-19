import { createRequire } from "node:module";
import type { PrismaClient as PrismaClientType } from "@prisma/client";

// @prisma/client is CommonJS: load it with require so the named export resolves under native ESM. The client is generated from
// apps/web/prisma/schema.prisma (`pnpm db:generate`) into the shared package directory.
const { PrismaClient } = createRequire(import.meta.url)("@prisma/client") as typeof import("@prisma/client");

export type Prisma = PrismaClientType;

export function createPrismaClient(databaseUrl: string): Prisma {
  // lazy connection: constructing the client never touches the network, so start-up does not depend on the database
  return new PrismaClient({ datasources: { db: { url: databaseUrl } }, log: [] });
}
