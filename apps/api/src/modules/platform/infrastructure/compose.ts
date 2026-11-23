import type { ApiConfig } from "../../../config/env.js";
import { KavenegarSms, type SmsSender } from "../../../platform/sms/sms.js";
import { envelopeCipher } from "../../secrets/secrets.api.js";
import { PlatformSettingsService } from "../application/settings.service.js";
import { PrismaSettingsRepository } from "./prisma-settings.repository.js";

/** Composition: PostgreSQL storage and the store-secrets envelope scheme (null = no master keys: secrets cannot be stored). */
export function createPlatformSettingsService(keys: ApiConfig["secrets"]): PlatformSettingsService {
  return new PlatformSettingsService(new PrismaSettingsRepository(), keys ? envelopeCipher(keys) : null);
}

/**
 * The SMS sender for customer sign-in, built from the platform settings (D31-2/D31-3): null unless sign-in by SMS is switched on AND the
 * template and the Kavenegar key are set. Cached for 30 s, so a settings change applies within half a minute without a restart.
 */
export function otpSenderSource(settings: PlatformSettingsService, ttlMs = 30_000): () => Promise<SmsSender | null> {
  let cached: { at: number; sender: SmsSender | null } | null = null;
  return async () => {
    if (cached && Date.now() - cached.at < ttlMs) return cached.sender;
    const { sms } = await settings.settings();
    let sender: SmsSender | null = null;
    if (sms.customerOtpEnabled && sms.otpTemplate) {
      const apiKey = await settings.reveal("sms.kavenegar.api_key");
      if (apiKey) sender = new KavenegarSms({ apiKey, template: sms.otpTemplate, apiBase: "https://api.kavenegar.com", timeoutMs: 5000 });
    }
    cached = { at: Date.now(), sender };
    return sender;
  };
}
