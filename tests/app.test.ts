import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { as, SESSION_COOKIE, signIn } from "./helpers/session.js";
const app = createApp();
// Requests carry a session cookie; signIn() makes it belong to a signed-in user.
const api = request.agent(app).set("Cookie", SESSION_COOKIE);
afterAll(() => prisma.$disconnect());
beforeEach(() => signIn(as.leadershipLead));
afterEach(() => vi.restoreAllMocks());
describe("HTTP boundaries without a database", () => {
  it("requires a session for every API route", async () => {
    vi.restoreAllMocks();
    for (const [method, path] of [
      ["get", "/api/v1/companies"],
      ["get", "/api/v1/teams"],
      ["post", "/api/v1/people"],
      ["get", "/api/v1/ai/status"],
    ] as const) {
      const res = await request(app)[method](path);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    }
  });
  it("blocks users who must change their temporary password", async () => {
    signIn(as.teamMember, { mustChangePassword: true });
    const res = await api.get("/api/v1/teams");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });
  it("provides liveness and request IDs", async () => {
    const res = await api.get("/health/live");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.headers["x-request-id"]).toBeTruthy();
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
  it("rejects invalid input before persistence", async () => {
    const res = await api
      .post("/api/v1/companies")
      .send({ name: "x", email: "bad", industry: "IT" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });
  it("rejects unknown writable fields", async () => {
    const res = await api.post("/api/v1/companies").send({
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
        await api
          .patch("/api/v1/companies/not-a-uuid")
          .send({ status: "ARCHIVED" })
      ).status,
    ).toBe(400);
    expect((await api.get("/api/v1/companies?limit=101")).status).toBe(400);
  });
  it("rejects empty updates and unsafe website schemes", async () => {
    expect(
      (
        await api
          .patch("/api/v1/companies/11111111-1111-4111-8111-111111111111")
          .send({})
      ).status,
    ).toBe(400);
    expect(
      (
        await api.post("/api/v1/companies").send({
          name: "Example",
          email: "a@example.com",
          industry: "IT",
          website: "javascript:alert(1)",
        })
      ).status,
    ).toBe(400);
  });
  it("handles malformed JSON and oversized bodies", async () => {
    const invalid = await api
      .post("/api/v1/companies")
      .set("Content-Type", "application/json")
      .send("{");
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("INVALID_JSON");
    const large = await api
      .post("/api/v1/companies")
      .send({ name: "x".repeat(40000) });
    expect(large.status).toBe(413);
  });
  it("only allows configured browser origins", async () => {
    const allowed = await api
      .get("/health/live")
      .set("Origin", "http://localhost:3000");
    expect(allowed.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000",
    );
    const denied = await api
      .get("/health/live")
      .set("Origin", "https://untrusted.example");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });
  it("returns a consistent 404", async () => {
    const res = await api.get("/missing");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
