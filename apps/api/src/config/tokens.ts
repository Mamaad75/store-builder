/** Injection tokens (explicit `@Inject`, so nothing depends on emitted decorator metadata). */
export const CONFIG = Symbol("API_CONFIG");
export const DATABASE = Symbol("API_DATABASE");
export const LOGGER = Symbol("API_LOGGER");
export const USERS = Symbol("API_USERS");
export const RATE_LIMITER = Symbol("API_RATE_LIMITER");
export const PRISMA_CLIENT = Symbol("API_PRISMA_CLIENT");
