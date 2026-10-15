import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import {
  listTeams,
  searchPeople,
  checkView,
} from "../src/modules/ai/ai.tools.js";

const app = createApp();
const suffix = randomUUID().slice(0, 8);
const teamIds: string[] = [];
const personIds: string[] = [];

afterAll(async () => {
  await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
  await prisma.person.deleteMany({ where: { id: { in: personIds } } });
  await prisma.$disconnect();
});

async function createPerson(name: string, teamIdsForPerson: string[]) {
  const res = await request(app)
    .post("/api/v1/people")
    .send({
      name,
      email: `${name.toLowerCase().replace(/\W+/g, ".")}.${suffix}@example.com`,
      role: "Engineer",
      location: "Pune, India",
      timezone: "Asia/Kolkata",
      teamIds: teamIdsForPerson,
    });
  expect(res.status).toBe(201);
  personIds.push(res.body.data.id);
  return res.body.data;
}

describe("teams and people against PostgreSQL", () => {
  it("manages teams, multi-team membership and the safety rules", async () => {
    // A lead must exist before a team; bootstrap one person into a seed-free first team.
    const bootstrap = await prisma.person.create({
      data: {
        name: `Lead ${suffix}`,
        email: `lead.${suffix}@example.com`,
        role: "Lead",
        location: "Austin, US",
        timezone: "America/Chicago",
      },
    });
    personIds.push(bootstrap.id);

    const alpha = await request(app)
      .post("/api/v1/teams")
      .send({
        name: `Alpha ${suffix}`,
        purpose: "First team",
        leadId: bootstrap.id,
      });
    expect(alpha.status).toBe(201);
    expect(alpha.body.data.members.map((m: { id: string }) => m.id)).toEqual([
      bootstrap.id,
    ]);
    teamIds.push(alpha.body.data.id);

    const beta = await request(app)
      .post("/api/v1/teams")
      .send({
        name: `Beta ${suffix}`,
        purpose: "Second team",
        leadId: bootstrap.id,
        icon: "code",
      });
    teamIds.push(beta.body.data.id);

    expect(
      (
        await request(app)
          .post("/api/v1/teams")
          .send({
            name: `alpha ${suffix}`.toUpperCase(),
            purpose: "Clash",
            leadId: bootstrap.id,
          })
      ).status,
    ).toBe(409);

    const nina = await createPerson(`Nina ${suffix}`, [
      alpha.body.data.id,
      beta.body.data.id,
    ]);
    expect(nina.teams).toHaveLength(2);

    const inBeta = await request(app).get(
      `/api/v1/people?teamId=${beta.body.data.id}`,
    );
    expect(inBeta.body.data.map((p: { id: string }) => p.id).sort()).toEqual(
      [bootstrap.id, nina.id].sort(),
    );

    const removed = await request(app).delete(
      `/api/v1/teams/${beta.body.data.id}/members/${nina.id}`,
    );
    expect(removed.status).toBe(200);
    expect(
      (
        await request(app).delete(
          `/api/v1/teams/${alpha.body.data.id}/members/${nina.id}`,
        )
      ).body.error.code,
    ).toBe("LAST_TEAM");
    expect(
      (
        await request(app).delete(
          `/api/v1/teams/${alpha.body.data.id}/members/${bootstrap.id}`,
        )
      ).body.error.code,
    ).toBe("LEAD_CANNOT_LEAVE");
    expect(
      (await request(app).delete(`/api/v1/teams/${alpha.body.data.id}`)).body
        .error.code,
    ).toBe("TEAM_HAS_ONLY_MEMBERS");

    const newLead = await request(app)
      .patch(`/api/v1/teams/${beta.body.data.id}`)
      .send({ leadId: nina.id });
    expect(newLead.body.data.lead.id).toBe(nina.id);
    expect(
      newLead.body.data.members.some((m: { id: string }) => m.id === nina.id),
    ).toBe(true);
    expect(
      (await request(app).delete(`/api/v1/people/${nina.id}`)).body.error.code,
    ).toBe("PERSON_LEADS_TEAM");
  });

  it("gives the AI tools live, ID-checked records", async () => {
    const teams = await listTeams();
    const mine = teams.find((team) => team.name === `Alpha ${suffix}`);
    expect(mine?.members.length).toBeGreaterThan(0);
    const people = await searchPeople({ query: `Nina ${suffix}` });
    expect(people).toHaveLength(1);
    expect(
      await checkView({
        kind: "people",
        title: "Nina",
        personIds: [people[0]!.id],
      }),
    ).toBeNull();
    expect(
      await checkView({
        kind: "people",
        title: "Ghost",
        personIds: [randomUUID()],
      }),
    ).toContain("don't exist");
  });
});
