import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const app = createApp();
afterAll(() => prisma.$disconnect());

const validId = "bbbbbbbb-0000-4000-8000-000000000001";

describe("teams and people request boundaries (no database)", () => {
  it("rejects invalid team input and unknown writable fields", async () => {
    expect(
      (await request(app).post("/api/v1/teams").send({ name: "x" })).status,
    ).toBe(400);
    expect(
      (
        await request(app).post("/api/v1/teams").send({
          name: "Platform",
          purpose: "Runs the platform",
          leadId: validId,
          icon: "not-an-icon",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app).post("/api/v1/teams").send({
          name: "Platform",
          purpose: "Runs the platform",
          leadId: validId,
          memberCount: 99,
        })
      ).status,
    ).toBe(400);
  });

  it("requires every new person to join at least one team", async () => {
    const res = await request(app).post("/api/v1/people").send({
      name: "New Person",
      email: "new@example.com",
      role: "Engineer",
      location: "Pune, India",
      timezone: "Asia/Kolkata",
      teamIds: [],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors.teamIds).toBeTruthy();
  });

  it("rejects invalid IDs, empty updates and bad filters", async () => {
    expect((await request(app).get("/api/v1/teams/not-a-uuid")).status).toBe(
      400,
    );
    expect(
      (await request(app).patch(`/api/v1/people/${validId}`).send({})).status,
    ).toBe(400);
    expect((await request(app).get("/api/v1/people?ids=one,two")).status).toBe(
      400,
    );
    expect(
      (
        await request(app)
          .post(`/api/v1/teams/${validId}/members`)
          .send({ personId: "nope" })
      ).status,
    ).toBe(400);
  });
});
