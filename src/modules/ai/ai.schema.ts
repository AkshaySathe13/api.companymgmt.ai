import { z } from "zod";

const turn = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(4000),
  })
  .strict();

export const askInput = z
  .object({
    question: z.string().trim().min(2).max(2000),
    // Earlier turns of this conversation, oldest first: user, assistant, user, assistant…
    history: z.array(turn).max(12).default([]),
  })
  .strict()
  .refine(
    ({ history }) =>
      history.every(
        (entry, index) => entry.role === (index % 2 ? "assistant" : "user"),
      ) && history.length % 2 === 0,
    {
      message: "History must alternate user and assistant turns",
      path: ["history"],
    },
  );

export const viewKinds = ["teams_overview", "team", "people"] as const;

// A view references records by ID; the frontend loads current data for them.
export const viewInput = z
  .object({
    kind: z
      .enum(viewKinds)
      .describe(
        '"teams_overview" shows every team, "team" shows one team, "people" shows a table of specific people',
      ),
    title: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .describe("Short heading for the view"),
    // teamId is required for "team"; personIds for "people" (checked when the view is shown).
    teamId: z.uuid().optional(),
    personIds: z.array(z.uuid()).max(50).optional(),
  })
  .strict();

export type AiView = z.infer<typeof viewInput>;
