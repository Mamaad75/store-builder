import type { Permission } from "./permissions.js";

/** A staff member asked for something their role does not allow (HTTP 403). A non-member gets NotFoundError instead (no existence leak). */
export class PermissionDeniedError extends Error {
  constructor(public readonly permission: Permission) {
    super("permission denied");
    this.name = "PermissionDeniedError";
  }
}

/** The invited username does not belong to an account that can be invited (unknown, the owner, already staff, or yourself). */
export class InvitationTargetError extends Error {
  constructor(public readonly reason: "unknown_user" | "owner" | "already_member" | "already_invited" | "self") {
    super("invitation target not allowed");
    this.name = "InvitationTargetError";
  }
}

/** Members plus pending invitations reached MAX_STAFF_PER_STORE. */
export class StaffLimitError extends Error {
  constructor(public readonly limit: number) {
    super("staff limit reached");
    this.name = "StaffLimitError";
  }
}
