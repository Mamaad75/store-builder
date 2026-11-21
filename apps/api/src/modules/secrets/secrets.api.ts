/**
 * Public API of the secrets module (phase 2.4). `SecretService.reveal` is how a server-side consumer (payments, phase 3) reads a store's
 * secret; nothing here is ever exposed over HTTP.
 */
export { SecretService } from "./application/secret.service.js";
export { createSecretService } from "./infrastructure/compose.js";
export { rotateSecrets, type RotationResult } from "./infrastructure/rotation.js";
