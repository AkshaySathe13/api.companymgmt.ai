import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";
import { logger } from "./lib/logger.js";

// This scaffold deliberately has no identity provider yet. Fail closed in production.
if (env.NODE_ENV === "production")
  throw new Error(
    "Production startup is disabled until authentication and authorization are implemented. See README.md.",
  );
const server = createApp().listen(env.PORT, env.HOST, () =>
  logger.info({ port: env.PORT, host: env.HOST }, "API listening"),
);
let stopping = false;
function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "Shutting down");
  const timeout = setTimeout(() => process.exit(1), 10_000).unref();
  server.close(() => {
    void prisma
      .$disconnect()
      .then(() => {
        clearTimeout(timeout);
        process.exit(0);
      })
      .catch(() => process.exit(1));
  });
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
server.on("error", (error) => {
  logger.fatal({ err: error }, "Server failed");
  void prisma.$disconnect().finally(() => process.exit(1));
});
