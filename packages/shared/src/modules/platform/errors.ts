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
