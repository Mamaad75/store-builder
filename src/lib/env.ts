import { z } from "zod";

const schema = z.object({
  APP_ROOT_DOMAIN: z.string().min(1).default("localhost:3000"),
  APP_PROTOCOL: z.enum(["http", "https"]).default("http"),
});

export type AppEnv = z.infer<typeof schema>;

/** Public/platform config. Server-only secrets (DB, S3, auth) are validated in their own modules. */
export function getAppEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return schema.parse({
    APP_ROOT_DOMAIN: source.APP_ROOT_DOMAIN || undefined,
    APP_PROTOCOL: source.APP_PROTOCOL || undefined,
  });
}
