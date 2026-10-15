import { z } from "zod";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { AppError } from "../../lib/errors.js";
import { teamService } from "../teams/team.service.js";
import { personService } from "../people/person.service.js";
import { viewInput, viewKinds, type AiView } from "./ai.schema.js";

export const MAX_VIEWS = 3;

// Tool results are kept compact: Claude reads them, the frontend loads full records by ID.
const json = (value: unknown) => JSON.stringify(value);

const uuid = { type: "string", format: "uuid" } as const;
const searchInput = z
  .object({
    query: z.string().max(120).optional(),
    teamId: z.uuid().optional(),
  })
  .strict();

/** Runs a tool body, turning validation and "not found" problems into a result Claude can read and recover from. */
async function safely<T>(
  schema: z.ZodType<T>,
  input: unknown,
  run: (value: T) => Promise<string>,
) {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    return json({
      error: "Invalid input",
      issues: z.flattenError(parsed.error),
    });
  try {
    return await run(parsed.data);
  } catch (error) {
    if (error instanceof AppError) return json({ error: error.message });
    throw error;
  }
}

export async function listTeams() {
  const { data } = await teamService.list({ search: "" });
  return data.map((team) => ({
    id: team.id,
    name: team.name,
    purpose: team.purpose,
    kind: team.kind,
    lead: team.lead ? { id: team.lead.id, name: team.lead.name } : null,
    members: team.members.map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      workMode: member.workMode,
    })),
  }));
}

export async function searchPeople(input: { query?: string; teamId?: string }) {
  const { data } = await personService.list({
    search: input.query ?? "",
    teamId: input.teamId,
    ids: undefined,
    limit: 50,
  });
  return data.map((person) => ({
    id: person.id,
    name: person.name,
    role: person.role,
    email: person.email,
    location: person.location,
    timezone: person.timezone,
    workMode: person.workMode,
    kind: person.kind,
    teams: person.teams.map((team) => team.name),
    leadsTeamIds: person.leadsTeamIds,
  }));
}

/** Checks a requested view against the records it references. Returns an error message or null. */
export async function checkView(view: AiView) {
  if (view.kind === "team") {
    if (!view.teamId) return 'A "team" view needs a teamId.';
    await teamService.get(view.teamId);
  }
  if (view.kind === "people") {
    if (!view.personIds?.length) return 'A "people" view needs personIds.';
    const { data } = await personService.list({
      search: "",
      ids: view.personIds,
      teamId: undefined,
      limit: 50,
    });
    if (data.length !== new Set(view.personIds).size)
      return "Some personIds don't exist. Use IDs returned by the other tools.";
  }
  return null;
}

export function createTools(views: AiView[]) {
  return [
    betaTool({
      name: "list_teams",
      description:
        "List every company team with its ID, purpose, kind, lead and members (ID, name, role, work mode). One person can belong to several teams. Use this for any question about teams, leads or who is in which team.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      run: (input) =>
        safely(z.object({}).strict(), input, async () =>
          json(await listTeams()),
        ),
    }),
    betaTool({
      name: "search_people",
      description:
        "Search the people directory by name, role, email or location, optionally limited to one team. Returns up to 50 people with ID, role, location, time zone, work mode (OFFICE, REMOTE or EXTERNAL), kind (STAFF or EXTERNAL) and team names. Leave query empty to list everyone.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", maxLength: 120 },
          teamId: uuid,
        },
        additionalProperties: false,
      },
      run: (input) =>
        safely(searchInput, input, async (value) =>
          json(await searchPeople(value)),
        ),
    }),
    betaTool({
      name: "show_view",
      description: `Show a view beside your written answer, built from live records. Use kind "people" with personIds for a table of specific people, kind "team" with teamId for one team's lead and members, or kind "teams_overview" for all teams. Only use IDs returned by list_teams or search_people. At most ${MAX_VIEWS} views per answer.`,
      inputSchema: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...viewKinds] },
          title: {
            type: "string",
            minLength: 1,
            maxLength: 80,
            description: "Short heading for the view",
          },
          teamId: uuid,
          personIds: { type: "array", items: uuid, maxItems: 50 },
        },
        required: ["kind", "title"],
        additionalProperties: false,
      },
      run: (input) =>
        safely(viewInput, input, async (view) => {
          if (views.length >= MAX_VIEWS)
            return `Limit reached: only ${MAX_VIEWS} views can be shown.`;
          const problem = await checkView(view);
          if (problem) return json({ error: problem });
          views.push(view);
          return "Shown to the user.";
        }),
    }),
  ];
}
