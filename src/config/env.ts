import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().url(),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((value) =>
      value.split(",").map((origin) => new URL(origin.trim()).origin),
    ),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  // Optional: without a key the AI endpoints report "not configured" and the rest of the API keeps working.
  ANTHROPIC_API_KEY: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined),
  AI_MODEL: z.string().trim().min(1).default("claude-opus-5-5"),
});

const result = schema.safeParse(process.env);
if (!result.success)
  throw new Error(
    `Invalid environment variables: ${result.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
  );
export const env = result.data;
