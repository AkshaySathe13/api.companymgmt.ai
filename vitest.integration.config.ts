import "dotenv/config";
import { defineConfig } from "vitest/config";
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith("_test")
)
  throw new Error(
    "TEST_DATABASE_URL must point to a dedicated database ending in _test",
  );
export default defineConfig({
  test: {
    include: ["tests/**/*.integration.test.ts"],
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      // Tests never call the real Claude API, even when a key is in .env.
      ANTHROPIC_API_KEY: "",
    },
    fileParallelism: false,
  },
});
