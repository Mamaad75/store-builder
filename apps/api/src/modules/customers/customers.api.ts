/** Public API of the customers module (phase 3.1). */
export { CustomerAuthService } from "./application/customer-auth.service.js";
export { CustomersService } from "./application/customers.service.js";
export { purgeExpiredChallenges } from "./infrastructure/prisma-customers.repository.js";
/** Rate-limit key of a client address (IPv6 by /64); phase 3.3 bounds anonymous cart creation with it. */
export { ipLimitKey } from "./domain/otp.js";
/** Phase 3.3b, for the orders module: a guest order belongs to the store's customer with the same phone (created unverified). */
export { customerIdForPhoneInTx } from "./infrastructure/prisma-customers.repository.js";
export type { CustomerProfile } from "./application/customer-auth.service.js";
