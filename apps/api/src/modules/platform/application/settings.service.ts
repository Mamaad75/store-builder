import { secretValueSchema } from "@store-builder/shared/modules/secrets/schemas";
import { SecretsUnavailableError } from "@store-builder/shared/modules/secrets/errors";
import { NotFoundError, ValidationError } from "@store-builder/shared/modules/stores/errors";
import {
  PLATFORM_SETTING_DEFAULTS,
  PLATFORM_SETTING_SCHEMAS,
  PLATFORM_SECRETS,
  isPlatformSecretName,
  type PlatformSecretName,
  type PlatformSettingGroup,
  type PlatformSettings,
} from "@store-builder/shared/modules/platform/settings";
import { platformSecretContext, secretHint } from "../domain/platform.js";

export interface Sealed {
  keyId: string;
  wrappedKey: Uint8Array;
  sealed: Uint8Array;
}
export interface PlatformCipher {
  seal(context: string, value: string): Sealed;
  open(context: string, envelope: Sealed): string;
}
export interface SettingsAudit {
  actorId: string;
  action: string;
  targetId: string;
}
export interface SettingsRepository {
  all(): Promise<Partial<Record<PlatformSettingGroup, unknown>>>;
  put(group: PlatformSettingGroup, value: unknown, audit: SettingsAudit): Promise<void>;
  secrets(): Promise<{ name: string; hint: string | null; updatedAt: Date }[]>;
  secret(name: string): Promise<Sealed | null>;
  putSecret(name: string, e: Sealed, hint: string | null, audit: SettingsAudit): Promise<void>;
  removeSecret(name: string, audit: SettingsAudit): Promise<boolean>;
}

export interface SecretState {
  configured: boolean;
  hint: string | null;
  updatedAt: Date | null;
}
export interface PlatformSettingsView {
  settings: PlatformSettings;
  secrets: Record<PlatformSecretName, SecretState>;
  /** false when the server has no master keys (SECRETS_MASTER_KEYS): keys cannot be stored until it does. */
  encryptionReady: boolean;
}

/**
 * Platform settings and platform secrets (phase 3.1, D31-3), managed by super admins. Settings are validated by the shared schemas on
 * write and read back defensively (an unreadable stored value falls back to the defaults: everything off). Secret values are write-only:
 * no method that a controller calls returns one; `reveal` is for server-side consumers (the SMS sender).
 */
export class PlatformSettingsService {
  constructor(
    private readonly repo: SettingsRepository,
    private readonly cipher: PlatformCipher | null,
  ) {}

  async settings(): Promise<PlatformSettings> {
    const stored = await this.repo.all();
    const read = <G extends PlatformSettingGroup>(g: G): PlatformSettings[G] => {
      const r = PLATFORM_SETTING_SCHEMAS[g].safeParse(stored[g]);
      return (r.success ? r.data : PLATFORM_SETTING_DEFAULTS[g]) as PlatformSettings[G];
    };
    return { sms: read("sms"), payment: read("payment"), ai: read("ai"), rates: read("rates") };
  }

  async view(): Promise<PlatformSettingsView> {
    const [settings, rows] = await Promise.all([this.settings(), this.repo.secrets()]);
    const secrets = Object.fromEntries(
      (Object.keys(PLATFORM_SECRETS) as PlatformSecretName[]).map((n) => {
        const row = rows.find((x) => x.name === n);
        return [n, { configured: Boolean(row), hint: row?.hint ?? null, updatedAt: row?.updatedAt ?? null }];
      }),
    ) as Record<PlatformSecretName, SecretState>;
    return { settings, secrets, encryptionReady: this.cipher !== null };
  }

  async update(actorId: string, group: unknown, input: unknown): Promise<PlatformSettings> {
    if (typeof group !== "string" || !Object.prototype.hasOwnProperty.call(PLATFORM_SETTING_SCHEMAS, group)) throw new NotFoundError();
    const g = group as PlatformSettingGroup;
    const r = PLATFORM_SETTING_SCHEMAS[g].safeParse(input);
    if (!r.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const i of r.error.issues) (fieldErrors[String(i.path[0] ?? "_")] ??= []).push(i.message);
      throw new ValidationError(fieldErrors);
    }
    await this.repo.put(g, r.data, { actorId, action: "platform.settings_updated", targetId: g });
    return this.settings();
  }

  async setSecret(actorId: string, name: unknown, input: unknown): Promise<void> {
    if (!isPlatformSecretName(name)) throw new NotFoundError();
    if (!this.cipher) throw new SecretsUnavailableError();
    const r = secretValueSchema.safeParse(input);
    if (!r.success) throw new ValidationError({ value: ["مقدار نامعتبر است (خالی، خیلی طولانی یا با نویسه‌ی نامعتبر)."] });
    const sealed = this.cipher.seal(platformSecretContext(name), r.data.value);
    await this.repo.putSecret(name, sealed, secretHint(r.data.value), { actorId, action: "platform.secret_set", targetId: name });
  }

  async removeSecret(actorId: string, name: unknown): Promise<void> {
    if (!isPlatformSecretName(name)) throw new NotFoundError();
    if (!(await this.repo.removeSecret(name, { actorId, action: "platform.secret_deleted", targetId: name }))) throw new NotFoundError();
  }

  /** Server-side only (never routed): the plaintext of a platform secret, or null when it is not set. */
  async reveal(name: PlatformSecretName): Promise<string | null> {
    if (!this.cipher) return null;
    const e = await this.repo.secret(name);
    return e ? this.cipher.open(platformSecretContext(name), e) : null;
  }
}
