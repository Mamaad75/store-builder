import { Prisma } from "@prisma/client";
import { ValidationError } from "@/modules/stores/errors";

/**
 * Maps database constraint violations that can legitimately happen to user-facing validation errors.
 * Anything else is rethrown. P2003 (foreign key) can only occur for a category that vanished or never
 * belonged to the store, and is reported exactly like any other invalid category.
 */
export function mapCatalogDbError(e: unknown, fields: { unique?: Record<string, string> } = {}): unknown {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") {
      const target = ([] as string[]).concat((e.meta?.target as string[] | string | undefined) ?? []).join(",");
      for (const [field, message] of Object.entries(fields.unique ?? {})) {
        if (target.includes(field)) return new ValidationError({ [field]: [message] });
      }
      return new ValidationError({ _form: ["مقدار تکراری است"] });
    }
    if (e.code === "P2003") return new ValidationError({ categoryId: ["دسته انتخاب‌شده معتبر نیست"] });
  }
  return e;
}
