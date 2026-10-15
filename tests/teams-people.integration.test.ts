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
const manager = { "X-Preview-Role": "manager" };
const executive = { "X-Preview-Role": "executive" };
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
      .set(manager)
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
      .set(manager)
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
          .set(manager)
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

    const removed = await request(app)
      .delete(`/api/v1/teams/${beta.body.data.id}/members/${nina.id}`)
      .set(manager);
    expect(removed.status).toBe(200);
    expect(
      (
        await request(app)
          .delete(`/api/v1/teams/${alpha.body.data.id}/members/${nina.id}`)
          .set(manager)
      ).body.error.code,
    ).toBe("LAST_TEAM");
    expect(
      (
        await request(app)
          .delete(`/api/v1/teams/${alpha.body.data.id}/members/${bootstrap.id}`)
          .set(manager)
      ).body.error.code,
    ).toBe("LEAD_CANNOT_LEAVE");
    expect(
      (
        await request(app)
          .delete(`/api/v1/teams/${alpha.body.data.id}`)
          .set(manager)
      ).body.error.code,
    ).toBe("TEAM_HAS_ONLY_MEMBERS");

    const newLead = await request(app)
      .patch(`/api/v1/teams/${beta.body.data.id}`)
      .set(manager)
      .send({ leadId: nina.id });
    expect(newLead.body.data.lead.id).toBe(nina.id);
    expect(
      newLead.body.data.members.some((m: { id: string }) => m.id === nina.id),
    ).toBe(true);
    expect(
      (await request(app).delete(`/api/v1/people/${nina.id}`)).body.error.code,
    ).toBe("PERSON_LEADS_TEAM");
  });

  it("lets only an executive change a core team; developers change nothing", async () => {
    const lead = await prisma.person.create({
      data: {
        name: `Core lead ${suffix}`,
        email: `core.lead.${suffix}@example.com`,
        role: "Lead",
        location: "Austin, US",
        timezone: "America/Chicago",
      },
    });
    personIds.push(lead.id);
    const core = await prisma.team.create({
      data: {
        name: `Core ${suffix}`,
        purpose: "Core company team",
        leadId: lead.id,
        isCore: true,
        memberships: { create: { personId: lead.id } },
      },
    });
    teamIds.push(core.id);
    // A second team keeps the lead in a team once the core team is deleted.
    const other = await prisma.team.create({
      data: {
        name: `Other ${suffix}`,
        purpose: "Keeps the lead in a team",
        leadId: lead.id,
        memberships: { create: { personId: lead.id } },
      },
    });
    teamIds.push(other.id);
    const path = `/api/v1/teams/${core.id}`;

    const listed = await request(app).get(path);
    expect(listed.body.data.isCore).toBe(true);

    const managerEdit = await request(app)
      .patch(path)
      .set(manager)
      .send({ purpose: "Changed by a manager" });
    expect(managerEdit.status).toBe(403);
    expect(managerEdit.body.error.code).toBe("CORE_TEAM_LOCKED");
    expect((await request(app).delete(path).set(manager)).body.error.code).toBe(
      "CORE_TEAM_LOCKED",
    );

    const anonymous = await request(app)
      .patch(path)
      .send({ purpose: "No role header" });
    expect(anonymous.body.error.code).toBe("FORBIDDEN");
    expect(
      (
        await request(app)
          .post("/api/v1/teams")
          .set({ "X-Preview-Role": "developer" })
          .send({ name: `Dev ${suffix}`, purpose: "Nope", leadId: lead.id })
      ).body.error.code,
    ).toBe("FORBIDDEN");

    const executiveEdit = await request(app)
      .patch(path)
      .set(executive)
      .send({ purpose: "Changed by an executive", isCore: false });
    expect(executiveEdit.status).toBe(400); // isCore can't be changed through the API
    const edited = await request(app)
      .patch(path)
      .set(executive)
      .send({ purpose: "Changed by an executive" });
    expect(edited.body.data.purpose).toBe("Changed by an executive");
    expect((await request(app).delete(path).set(executive)).status).toBe(204);
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
