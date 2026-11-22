import { z } from "zod";
import { STAFF_ROLES } from "./permissions.js";

/** Request bodies of the staff endpoints (phase 2.3; moved here in 2.5 so the API contract documents exactly what the API validates). */
export const inviteSchema = z.object({ username: z.string().trim().min(1).max(64), role: z.enum(STAFF_ROLES) }).strict();
export const roleSchema = z.object({ role: z.enum(STAFF_ROLES) }).strict();
