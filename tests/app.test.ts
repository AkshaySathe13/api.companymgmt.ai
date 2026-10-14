import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
const app = createApp();
afterAll(() => prisma.$disconnect());
describe("HTTP boundaries without a database", () => {
  it("provides liveness and request IDs", async () => {
    const res = await request(app).get("/health/live");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.headers["x-request-id"]).toBeTruthy();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
  it("rejects invalid input before persistence", async () => {
    const res = await request(app)
      .post("/api/v1/companies")
      .send({ name: "x", email: "bad", industry: "IT" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
  it("rejects unknown writable fields", async () => {
    const res = await request(app).post("/api/v1/companies").send({
      name: "Example",
      email: "hello@example.com",
      industry: "IT",
      id: "injected",
    });
    expect(res.status).toBe(400);
  });
  it("rejects invalid IDs and pagination", async () => {
    expect(
      (
        await request(app)
          .patch("/api/v1/companies/not-a-uuid")
          .send({ status: "ARCHIVED" })
      ).status,
    ).toBe(400);
    expect((await request(app).get("/api/v1/companies?limit=101")).status).toBe(
      400,
    );
  });
  it("rejects empty updates and unsafe website schemes", async () => {
    expect(
      (
        await request(app)
          .patch("/api/v1/companies/11111111-1111-4111-8111-111111111111")
          .send({})
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app).post("/api/v1/companies").send({
          name: "Example",
          email: "a@example.com",
          industry: "IT",
          website: "javascript:alert(1)",
        })
      ).status,
    ).toBe(400);
  });
  it("handles malformed JSON and oversized bodies", async () => {
    const invalid = await request(app)
      .post("/api/v1/companies")
      .set("Content-Type", "application/json")
      .send("{");
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("INVALID_JSON");
    const large = await request(app)
      .post("/api/v1/companies")
      .send({ name: "x".repeat(40000) });
    expect(large.status).toBe(413);
  });
  it("only allows configured browser origins", async () => {
    const allowed = await request(app)
      .get("/health/live")
      .set("Origin", "http://localhost:3000");
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000",
    );
    const denied = await request(app)
      .get("/health/live")
      .set("Origin", "https://untrusted.example");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("returns a consistent 404", async () => {
    const res = await request(app).get("/missing");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
