/** Platform administration errors (phase 3.1). */
export class PlatformAdminConflictError extends Error {
  constructor(public readonly reason: "already_admin" | "last_admin" | "self") {
    super(reason === "last_admin" ? "آخرین مدیر پلتفرم را نمی‌توان حذف کرد." : reason === "self" ? "این کار روی حساب خودتان ممکن نیست." : "این کاربر از قبل مدیر پلتفرم است.");
    this.name = "PlatformAdminConflictError";
  }
}

/** The acting operator is no longer a super admin (revoked while the request was in flight). */
export class PlatformForbiddenError extends Error {
  constructor() {
    super("دسترسی مدیریت پلتفرم ندارید.");
    this.name = "PlatformForbiddenError";
  }
}

/** ADR 0003 (G2): suspending a store that is already suspended, or restoring / amending one that is not. */
export class StoreSuspensionConflictError extends Error {
  constructor(public readonly reason: "already_suspended" | "not_suspended") {
    super(reason === "already_suspended" ? "این فروشگاه از قبل معلق است." : "این فروشگاه معلق نیست.");
    this.name = "StoreSuspensionConflictError";
  }
}
