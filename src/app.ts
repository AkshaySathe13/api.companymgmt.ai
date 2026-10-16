import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { isWriteConflict, prisma } from "./lib/prisma.js";
import { describePrismaError } from "./lib/db-errors.js";
import { AppError } from "./lib/errors.js";
import { companyRouter } from "./modules/companies/company.routes.js";
import { teamRouter } from "./modules/teams/team.routes.js";
import { personRouter } from "./modules/people/person.routes.js";
import { aiRouter } from "./modules/ai/ai.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { authenticate } from "./modules/auth/session.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(
    pinoHttp({
      logger,
      genReqId: (_req, res) => {
        const id = randomUUID();
        res.setHeader("X-Request-Id", id);
        return id;
      },
    }),
  );
  app.use(helmet());
  // The frontend proxies /api, so browsers normally call same-origin; CORS covers direct calls.
  app.use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
      exposedHeaders: ["X-Request-Id"],
    }),
  );
  app.get("/health/live", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.get("/health/ready", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: "ready" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: {
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Try again shortly.",
        },
      },
    }),
  );
  app.use(express.json({ limit: "32kb" }));
  // Sign-in routes are public; everything else needs a signed-in, active user.
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1", authenticate);
  app.use("/api/v1/companies", companyRouter);
  app.use("/api/v1/teams", teamRouter);
  app.use("/api/v1/people", personRouter);
  app.use("/api/v1/ai", aiRouter);
  app.use((_req, _res, next) => {
    next(new AppError(404, "NOT_FOUND", "Route not found"));
  });
  const handleError: ErrorRequestHandler = (
    error: unknown,
    req,
    res,
    _next,
  ) => {
    let status = 500,
      code = "INTERNAL_ERROR",
      message = "An unexpected error occurred";
    let details: unknown;
    if (error instanceof ZodError) {
      status = 400;
      code = "VALIDATION_ERROR";
      message = "Check the submitted fields";
      details = error.flatten();
    } else if (error instanceof AppError) {
      ({ status, code, message } = error);
    } else if (describePrismaError(error)) {
      // Services check these rules first; this covers a change that slipped in concurrently.
      ({ status, code, message } = describePrismaError(error)!);
    } else if (isWriteConflict(error)) {
      status = 409;
      code = "RETRY";
      message = "Someone else changed this at the same time. Please try again.";
    } else if (
      error instanceof SyntaxError &&
      "status" in error &&
      error.status === 400
    ) {
      status = 400;
      code = "INVALID_JSON";
      message = "Request body must be valid JSON";
    } else if (
      typeof error === "object" &&
      error !== null &&
      "type" in error &&
      error.type === "entity.too.large"
    ) {
      status = 413;
      code = "PAYLOAD_TOO_LARGE";
      message = "Request body exceeds 32kb";
    }
    if (status === 500) req.log.error({ err: error }, "Request failed");
    res.status(status).json({
      error: {
        code,
        message,
        ...(details ? { details } : {}),
        requestId: req.id,
      },
    });
  };
  app.use(handleError);
  return app;
}
