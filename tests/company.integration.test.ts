import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { randomUUID } from "node:crypto";
import { fixtures, signInAs } from "./helpers/users.js";
const app = createApp();
const ids: string[] = [];
const f = fixtures();
let api: Awaited<ReturnType<typeof signInAs>>;
beforeAll(async () => {
  const lead = await f.user("Company Lead");
  await f.team("Company Leadership", "LEADERSHIP", lead);
  api = await signInAs(app, lead);
});
afterAll(async () => {
  await prisma.company.deleteMany({ where: { id: { in: ids } } });
  await f.cleanup();
  await prisma.$disconnect();
});
describe("company lifecycle against PostgreSQL", () => {
  it("creates, retrieves, searches, updates, archives and restores a company", async () => {
    const name = `Integration ${randomUUID()}`;
    const created = await api.post("/api/v1/companies").send({
      name,
      email: "TEAM@example.com",
      industry: "Technology",
      website: "https://example.com",
    });
    expect(created.status).toBe(201);
    const id = created.body.data.id;
    ids.push(id);
    expect(created.body.data.email).toBe("team@example.com");
    expect((await api.get(`/api/v1/companies/${id}`)).body.data.name).toBe(
      name,
    );
    const list = await api
      .get("/api/v1/companies")
      .query({ search: name, status: "ACTIVE", limit: 1 });
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data[0].id).toBe(id);
    const updated = await api
      .patch(`/api/v1/companies/${id}`)
      .send({ industry: "Consulting", website: "" });
    expect(updated.body.data.website).toBeNull();
    expect(updated.body.data.name).toBe(name);
    expect(
      (await api.patch(`/api/v1/companies/${id}`).send({ status: "ARCHIVED" }))
        .body.data.status,
    ).toBe("ARCHIVED");
    expect(
      (
        await api
          .get("/api/v1/companies")
          .query({ search: name, status: "ACTIVE" })
      ).body.meta.total,
    ).toBe(0);
    expect(
      (await api.patch(`/api/v1/companies/${id}`).send({ status: "ACTIVE" }))
        .body.data.status,
    ).toBe("ACTIVE");
  });
  it("reports missing records on read and update", async () => {
    const id = randomUUID();
    expect((await api.get(`/api/v1/companies/${id}`)).status).toBe(404);
    expect(
      (await api.patch(`/api/v1/companies/${id}`).send({ name: "Missing" }))
        .status,
    ).toBe(404);
  });
  it("reports database readiness", async () => {
    expect((await request(app).get("/health/ready")).status).toBe(200);
  });
});
