import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import type { Viewer } from "../src/lib/access.js";
import {
  checkView,
  listTeams,
  searchPeople,
} from "../src/modules/ai/ai.tools.js";
import { fixtures } from "./helpers/users.js";

// The AI reads through the same access rules as the API, as the person asking.
const f = fixtures();
let ceo: Viewer, developer: Viewer, investor: Viewer;
let devId = "";
let outsiderId = "";
let devTeamId = "";
let investorsId = "";

beforeAll(async () => {
  const [lead, dev, otherLead, outsider, irm, backer] = await Promise.all([
    f.user("Lead"),
    f.user("Nina"),
    f.user("OtherLead"),
    f.user("Outsider"),
    f.user("Relations"),
    f.user("Backer", { workMode: "EXTERNAL" }),
  ]);
  const leadership = await f.team("Leadership", "LEADERSHIP", lead);
  const devTeam = await f.team("Alpha", "TECHNICAL", otherLead, [dev]);
  const other = await f.team("Beta", "TECHNICAL", outsider);
  const inv = await f.team("Backers", "EXTERNAL", irm, [backer]);
  devId = dev.id;
  outsiderId = outsider.id;
  devTeamId = devTeam.id;
  investorsId = inv.id;
  ceo = {
    id: lead.id,
    name: lead.name,
    memberships: [
      {
        teamId: leadership.id,
        teamKind: "LEADERSHIP",
        role: "LEADERSHIP_LEAD",
      },
    ],
  };
  developer = {
    id: dev.id,
    name: dev.name,
    memberships: [
      { teamId: devTeam.id, teamKind: "TECHNICAL", role: "TEAM_MEMBER" },
    ],
  };
  investor = {
    id: backer.id,
    name: backer.name,
    memberships: [{ teamId: inv.id, teamKind: "EXTERNAL", role: "INVESTOR" }],
  };
  void other;
});

afterAll(async () => {
  await f.cleanup();
  await prisma.$disconnect();
});

describe("AI tools against PostgreSQL", () => {
  it("gives the AI live, ID-checked records with team roles", async () => {
    const teams = await listTeams(ceo);
    const alpha = teams.find((team) => team.id === devTeamId);
    expect(alpha?.members.map((m) => m.teamRole).sort()).toEqual([
      "Team Manager",
      "Team Member",
    ]);
    const people = await searchPeople(ceo, { query: `Nina ${f.suffix}` });
    expect(people).toHaveLength(1);
    expect(people[0]!.email).toContain("nina.");
    expect(
      await checkView(ceo, {
        kind: "people",
        title: "Nina",
        personIds: [devId],
      }),
    ).toBeNull();
    expect(
      await checkView(ceo, {
        kind: "people",
        title: "Ghost",
        personIds: [randomUUID()],
      }),
    ).toContain("don't exist");
  });

  it("hides other teams' contact details from a developer's AI", async () => {
    const [outsider] = await searchPeople(developer, {
      query: `Outsider ${f.suffix}`,
    });
    expect(outsider).toMatchObject({
      restricted: true,
      email: null,
      location: null,
    });
    const [self] = await searchPeople(developer, { query: `Nina ${f.suffix}` });
    expect(self!.restricted).toBe(false);
  });

  it("keeps an investor's AI to their own team", async () => {
    const teams = await listTeams(investor);
    expect(teams.map((team) => team.id)).toEqual([investorsId]);
    expect(
      await searchPeople(investor, { query: `Outsider ${f.suffix}` }),
    ).toEqual([]);
    expect(
      await checkView(investor, {
        kind: "people",
        title: "x",
        personIds: [outsiderId],
      }),
    ).toContain("don't exist");
  });
});
