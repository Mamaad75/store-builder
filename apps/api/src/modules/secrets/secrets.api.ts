/**
 * Public API of the secrets module (phase 2.4). `SecretService.reveal` is how a server-side consumer (payments, phase 3) reads a store's
 * secret; nothing here is ever exposed over HTTP.
 */
export { SecretService } from "./application/secret.service.js";
export { createSecretService } from "./infrastructure/compose.js";
export { rotateSecrets, type RotationResult } from "./infrastructure/rotation.js";
// Phase 3.1: the platform module keeps its own secrets (PlatformSecret) with the SAME envelope scheme, through these.
export { envelopeCipher } from "./infrastructure/compose.js";
export { rewrapSealed } from "./infrastructure/rotation.js";
export { hintOf } from "./domain/secret.js";
export type { SealedSecret, SecretCipher } from "./application/ports.js";
