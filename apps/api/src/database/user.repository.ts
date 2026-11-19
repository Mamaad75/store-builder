import { Inject, Injectable } from "@nestjs/common";
import { PRISMA_CLIENT } from "../config/tokens.js";
import type { UserRecord, UserRepository } from "../auth/ports.js";
import type { Prisma } from "./prisma-client.js";

const SELECT = { id: true, username: true, name: true, passwordHash: true, authVersion: true } as const;

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(@Inject(PRISMA_CLIENT) private readonly db: Prisma) {}

  async create(data: { name: string; username: string; passwordHash: string }): Promise<UserRecord | null> {
    try {
      return await this.db.user.create({ data, select: SELECT });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002") return null; // unique index on username
      throw e;
    }
  }
  findByUsername(username: string) {
    return this.db.user.findUnique({ where: { username }, select: SELECT });
  }
  findById(id: string) {
    return this.db.user.findUnique({ where: { id }, select: SELECT });
  }
  async setPassword(id: string, passwordHash: string): Promise<void> {
    await this.db.user.update({ where: { id }, data: { passwordHash, authVersion: { increment: 1 } } });
  }
  async bumpAuthVersion(id: string): Promise<void> {
    await this.db.user.update({ where: { id }, data: { authVersion: { increment: 1 } } });
  }
}
