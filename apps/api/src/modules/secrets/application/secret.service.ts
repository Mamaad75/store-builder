import { z } from "zod";
import { SecretLimitError, SecretsUnavailableError } from "@store-builder/shared/modules/secrets/errors";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import { MAX_SECRETS_PER_STORE, MAX_SECRET_VALUE, hintOf, isSecretName, secretContext } from "../domain/secret.js";
import type { SecretActor, SecretCipher, SecretRepository, SecretSummary } from "./ports.js";

// The value is trimmed of surrounding whitespace (pasted keys often carry a newline) and must not contain control characters.
// Control (Cc), format (Cf: zero-width, bidi overrides) and lone-surrogate (Cs) characters are refused: they hide inside pasted keys.
const valueSchema = z.object({ value: z.string().trim().min(1).max(MAX_SECRET_VALUE).regex(/^[^\p{Cc}\p{Cf}\p{Cs}]*$/u, "نویسه‌ی نامعتبر") }).strict();

function nameOrNotFound(name: unknown): string {
  if (typeof name !== "string" || !isSecretName(name)) throw new NotFoundError();
  return name;
}

/**
 * Store secrets (phase 2.4, D24-1). Owners SET, LIST (names, masked hints, dates) and DELETE secrets; the plaintext value never leaves
 * this service except through `reveal`, which is for server-side consumers only (payments, phase 3) and is never routed.
 */
export class SecretService {
  constructor(
    private readonly repo: SecretRepository,
    private readonly cipher: SecretCipher | null,
  ) {}

  get configured(): boolean {
    return this.cipher !== null;
  }

  async list(a: SecretActor): Promise<{ configured: boolean; secrets: SecretSummary[] }> {
    return { configured: this.configured, secrets: await this.repo.list(a.storeId) };
  }

  async set(a: SecretActor, name: unknown, input: unknown): Promise<void> {
    const n = nameOrNotFound(name);
    const r = valueSchema.safeParse(input);
    if (!r.success) throw new ValidationError({ value: ["مقدار معتبر وارد کنید (حداکثر ۴۰۹۶ نویسه)."] }); // never echo the input
    if (!this.cipher) throw new SecretsUnavailableError();
    const sealed = this.cipher.seal(secretContext(a.storeId, n), r.data.value);
    const done = await this.repo.put(a.storeId, n, sealed, hintOf(r.data.value), { limit: MAX_SECRETS_PER_STORE, audit: { actorId: a.actorId, action: "secret.set" } });
    if (done === "limit") throw new SecretLimitError(MAX_SECRETS_PER_STORE);
  }

  async remove(a: SecretActor, name: unknown): Promise<void> {
    const n = nameOrNotFound(name);
    if (!(await this.repo.remove(a.storeId, n, { actorId: a.actorId, action: "secret.deleted" }))) throw new NotFoundError();
  }

  /** Server-side use only (never routed; an architecture test keeps it out of controllers). null = not set. */
  async reveal(storeId: string, name: string): Promise<string | null> {
    if (!this.cipher) throw new SecretsUnavailableError();
    const n = nameOrNotFound(name);
    const env = await this.repo.get(storeId, n);
    return env ? this.cipher.open(secretContext(storeId, n), env) : null;
  }
}
