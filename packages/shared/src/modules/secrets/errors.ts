/** Store secrets are not configured on this server (no SECRETS_MASTER_KEYS): HTTP 503, nothing was stored or read. */
export class SecretsUnavailableError extends Error {
  constructor() {
    super("store secrets are not configured on this server");
    this.name = "SecretsUnavailableError";
  }
}

/** The store already holds the maximum number of secrets. */
export class SecretLimitError extends Error {
  constructor(public readonly limit: number) {
    super("secret limit reached");
    this.name = "SecretLimitError";
  }
}
