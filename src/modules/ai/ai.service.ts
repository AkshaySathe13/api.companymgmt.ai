import Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import type { askInput, AiView } from "./ai.schema.js";
import { createTools } from "./ai.tools.js";

// Kept byte-stable (no dates or IDs) so the prompt prefix can be cached.
export const SYSTEM_PROMPT = `You are the AI assistant inside CarrierOS Command Center, the company's internal management portal.

You can read the company's teams and people through tools. People can belong to several teams. External people (kind EXTERNAL) are investors or other contacts, not employees.

How to answer:
- Look the facts up with the tools before answering. Never invent people, teams, roles, locations or counts.
- Keep the written answer short: two to five plain sentences. Name people and teams exactly as the records do.
- When a table or team card would help, call show_view with record IDs from the tool results. Prefer one or two focused views over many.
- Only teams and people are available in this portal so far. If asked about projects, tasks, releases, finance, sales or documents, say that area isn't connected yet and offer what you can answer from teams and people.
- If the records don't contain the answer, say so plainly.`;

// Models that accept the server-side refusal fallback in its "default" form.
const FALLBACK_MODELS = new Set([
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-fable-5-1",
  "claude-sonnet-5-5",
]);

export type AiClient = Pick<Anthropic, "beta">;

let client: Anthropic | undefined;
function defaultClient(): AiClient | undefined {
  if (!env.ANTHROPIC_API_KEY) return undefined;
  // The key comes from validated server config; it is never sent to the browser.
  client ??= new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    timeout: 90_000,
    maxRetries: 2,
  });
  return client;
}

export const aiService = {
  status() {
    return { configured: Boolean(env.ANTHROPIC_API_KEY), model: env.AI_MODEL };
  },

  async ask(
    input: z.infer<typeof askInput>,
    aiClient: AiClient | undefined = defaultClient(),
  ) {
    if (!aiClient)
      throw new AppError(
        503,
        "AI_NOT_CONFIGURED",
        "AI answers are off. Add ANTHROPIC_API_KEY to the API's .env file and restart the API.",
      );
    const views: AiView[] = [];
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...input.history,
      { role: "user", content: input.question },
    ];
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await aiClient.beta.messages.toolRunner({
        model: env.AI_MODEL,
        max_tokens: 16000,
        max_iterations: 8,
        output_config: { effort: "medium" },
        system: SYSTEM_PROMPT,
        tools: createTools(views),
        messages,
        ...(FALLBACK_MODELS.has(env.AI_MODEL)
          ? {
              betas: ["server-side-fallback-2026-07-01"],
              fallbacks: "default" as const,
            }
          : {}),
      });
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError)
        throw new AppError(
          503,
          "AI_UNAVAILABLE",
          "The Claude API key was rejected. Check ANTHROPIC_API_KEY.",
        );
      if (error instanceof Anthropic.RateLimitError)
        throw new AppError(
          429,
          "AI_RATE_LIMITED",
          "The AI is busy right now. Try again in a minute.",
        );
      if (error instanceof Anthropic.APIConnectionError)
        throw new AppError(
          503,
          "AI_UNAVAILABLE",
          "Can't reach the AI service. Everything else keeps working.",
        );
      if (error instanceof Anthropic.APIError)
        throw new AppError(
          502,
          "AI_FAILED",
          "The AI couldn't answer that. Try again or rephrase.",
        );
      throw error;
    }

    if (message.stop_reason === "refusal")
      return {
        answer: "I can't help with that request.",
        views: [],
        model: message.model,
        stopReason: message.stop_reason,
      };
    const text = message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n\n")
      .trim();
    let answer =
      text ||
      (views.length
        ? "Here's what I found."
        : "I couldn't find an answer in the teams and people records.");
    if (
      message.stop_reason === "max_tokens" ||
      message.stop_reason === "tool_use"
    )
      answer += "\n\nThis answer may be incomplete. Try a narrower question.";
    return {
      answer,
      views,
      model: message.model,
      stopReason: message.stop_reason,
    };
  },
};
