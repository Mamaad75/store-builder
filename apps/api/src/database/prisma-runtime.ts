import { createRequire } from "node:module";
import type * as PrismaTypes from "@prisma/client";

// @prisma/client is CommonJS: runtime values (the `Prisma` namespace: error classes, `sql`, `empty`) are loaded with require so they
// resolve under native ESM. Types come from the package as usual (`import type { Prisma } from "@prisma/client"`).
const mod = createRequire(import.meta.url)("@prisma/client") as typeof PrismaTypes;

export const Prisma = mod.Prisma;
