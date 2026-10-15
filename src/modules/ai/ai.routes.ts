import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { aiService } from "./ai.service.js";
import { askInput } from "./ai.schema.js";

export const aiRouter = Router();

// Each question can make several Claude calls, so it has its own, tighter limit.
const askLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many questions. Try again in a minute.",
    },
  },
});

aiRouter.get("/status", (_req, res) => {
  res.json({ data: aiService.status() });
});
aiRouter.post("/ask", askLimit, async (req, res) => {
  res.json({ data: await aiService.ask(askInput.parse(req.body)) });
});
