import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/**/*.integration.test.ts"],
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: "postgresql://unused:unused@localhost:55432/unused",
      // Tests never call the real Claude API, even when a key is in .env.
      ANTHROPIC_API_KEY: "",
    },
  },
});
