import { decrypt, encrypt, type MasterKeys } from "../../../platform/crypto/envelope.js";
import { SecretService } from "../application/secret.service.js";
import type { SecretCipher } from "../application/ports.js";
import { PrismaSecretRepository } from "./prisma-secret.repository.js";

/** AES-256-GCM envelope encryption with the configured master keys (platform/crypto/envelope.ts). */
export function envelopeCipher(keys: MasterKeys): SecretCipher {
  return {
    seal: (context, value) => encrypt(keys, context, value),
    open: (context, e) => decrypt(keys, context, { keyId: e.keyId, wrappedKey: Buffer.from(e.wrappedKey), sealed: Buffer.from(e.sealed) }),
  };
}

/** Composition: PostgreSQL storage (writes and their audit entries in one transaction) and the envelope cipher (null = feature off). */
export function createSecretService(keys: MasterKeys | null): SecretService {
  return new SecretService(new PrismaSecretRepository(), keys ? envelopeCipher(keys) : null);
}
