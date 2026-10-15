import { afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import Anthropic from "@anthropic-ai/sdk";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import {
  aiService,
  SYSTEM_PROMPT,
  type AiClient,
} from "../src/modules/ai/ai.service.js";

const app = createApp();
afterAll(() => prisma.$disconnect());

function fakeClient(result: unknown): {
  client: AiClient;
  toolRunner: ReturnType<typeof vi.fn>;
} {
  const toolRunner = vi.fn(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  );
  return {
    client: { beta: { messages: { toolRunner } } } as unknown as AiClient,
    toolRunner,
  };
}

const message = (overrides: Record<string, unknown>) => ({
  model: "claude-opus-5-5",
  stop_reason: "end_turn",
  content: [],
  ...overrides,
});

describe("AI endpoints without a configured key", () => {
  it("reports status and keeps the rest of the API usable", async () => {
    const status = await request(app).get("/api/v1/ai/status");
    expect(status.status).toBe(200);
    expect(status.body.data).toEqual({
      configured: false,
      model: "claude-opus-5-5",
    });
    const ask = await request(app)
      .post("/api/v1/ai/ask")
      .send({ question: "Who leads Sales?" });
    expect(ask.status).toBe(503);
    expect(ask.body.error.code).toBe("AI_NOT_CONFIGURED");
  });

  it("validates questions and conversation history", async () => {
    expect(
      (await request(app).post("/api/v1/ai/ask").send({ question: "" })).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/v1/ai/ask")
          .send({
            question: "And who else?",
            history: [{ role: "assistant", content: "Hi" }],
          })
      ).status,
    ).toBe(400);
  });
});

describe("aiService.ask", () => {
  it("sends the question with history, tools and a stable system prompt", async () => {
    const { client, toolRunner } = fakeClient(
      message({ content: [{ type: "text", text: "Riya Mehta leads Sales." }] }),
    );
    const result = await aiService.ask(
      {
        question: "Who leads Sales?",
        history: [
          { role: "user", content: "Hi" },
          { role: "assistant", content: "Hello" },
        ],
      },
      client,
    );
    expect(result.answer).toBe("Riya Mehta leads Sales.");
    expect(result.views).toEqual([]);
    const params = toolRunner.mock.calls[0]![0];
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.system).toBe(SYSTEM_PROMPT);
    expect(params.fallbacks).toBe("default");
    expect(params.messages.at(-1)).toEqual({
      role: "user",
      content: "Who leads Sales?",
    });
    expect(params.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "list_teams",
      "search_people",
      "show_view",
    ]);
  });

  it("checks refusals before reading content", async () => {
    const { client } = fakeClient(
      message({
        stop_reason: "refusal",
        content: [{ type: "text", text: "partial" }],
      }),
    );
    const result = await aiService.ask(
      { question: "Something unsafe", history: [] },
      client,
    );
    expect(result.answer).toBe("I can't help with that request.");
  });

  it("flags answers cut short by the iteration cap", async () => {
    const { client } = fakeClient(
      message({
        stop_reason: "tool_use",
        content: [{ type: "text", text: "So far:" }],
      }),
    );
    const result = await aiService.ask(
      { question: "Everything", history: [] },
      client,
    );
    expect(result.answer).toContain("may be incomplete");
  });

  it("maps Claude API failures to clear errors", async () => {
    const rateLimited = new Anthropic.RateLimitError(
      429,
      undefined,
      "slow down",
      new Headers(),
    );
    const { client } = fakeClient(rateLimited);
    await expect(
      aiService.ask({ question: "Who is in Sales?", history: [] }, client),
    ).rejects.toMatchObject({ status: 429, code: "AI_RATE_LIMITED" });
  });
});
