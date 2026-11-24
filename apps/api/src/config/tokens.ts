/** Injection tokens (explicit `@Inject`, so nothing depends on emitted decorator metadata). */
export const CONFIG = Symbol("API_CONFIG");
export const DATABASE = Symbol("API_DATABASE");
export const LOGGER = Symbol("API_LOGGER");
export const USERS = Symbol("API_USERS");
export const RATE_LIMITER = Symbol("API_RATE_LIMITER");
export const PRISMA_CLIENT = Symbol("API_PRISMA_CLIENT");
/** Phase 2.6: the API metrics (null when METRICS_PORT is not set) and the error reporter (a no-op when ERROR_TRACKING_DSN is not set). */
export const METRICS = Symbol("API_METRICS");
export const ERROR_REPORTER = Symbol("API_ERROR_REPORTER");
/** Phase 3.5: the payment gateway (tests inject a fake through AppOverrides.paymentGateway). */
export const PAYMENT_GATEWAY = Symbol("API_PAYMENT_GATEWAY");
