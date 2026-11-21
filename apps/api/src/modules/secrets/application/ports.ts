/** A stored envelope (see platform/crypto/envelope.ts); opaque bytes to the application layer. */
export interface SealedSecret {
  keyId: string;
  wrappedKey: Uint8Array;
  sealed: Uint8Array;
}

export interface SecretSummary {
  name: string;
  hint: string | null;
  updatedAt: Date;
}

export interface SecretRepository {
  list(storeId: string): Promise<SecretSummary[]>;
  get(storeId: string, name: string): Promise<SealedSecret | null>;
  /**
   * ONE transaction under a per-store lock: refuses a NEW name when the store already holds `limit` secrets ("limit"), otherwise writes the
   * envelope AND the audit entry together (a change never happens without its audit record, and concurrent writes cannot pass the cap).
   */
  put(storeId: string, name: string, envelope: SealedSecret, hint: string | null, o: { limit: number; audit: AuditEntry }): Promise<"ok" | "limit">;
  /** Deletes the secret and writes the audit entry in one transaction. false = no such secret (nothing written). */
  remove(storeId: string, name: string, audit: AuditEntry): Promise<boolean>;
}

export interface AuditEntry {
  actorId: string;
  action: "secret.set" | "secret.deleted";
}

/** Envelope encryption bound to a context; null when the server has no master keys (feature off). */
export interface SecretCipher {
  seal(context: string, value: string): SealedSecret;
  open(context: string, envelope: SealedSecret): string;
}

/** Who acts on which store (resolved by the access guard). */
export interface SecretActor {
  storeId: string;
  actorId: string;
}
