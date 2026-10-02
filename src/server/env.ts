import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_SECRET: z.string().min(16),
  EMAIL_PROVIDER: z.enum(["console", "resend"]).default("console"),
  EMAIL_FROM: z.string().default("Worklio <no-reply@example.com>"),
  RESEND_API_KEY: z.string().optional(),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./storage"),
  PAYMENT_PROVIDER: z.enum(["manual", "stripe"]).default("manual"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Lazily parsed so that `next build` and tests don't need every variable up front. */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
    }
    if (parsed.data.NODE_ENV === "production" && /change-me/i.test(parsed.data.APP_SECRET)) {
      throw new Error("APP_SECRET must be set to a unique random value in production");
    }
    cached = parsed.data;
  }
  return cached;
}
