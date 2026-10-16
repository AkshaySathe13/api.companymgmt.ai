import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { AppError } from "../src/lib/errors.js";
import { Prisma } from "../src/generated/prisma/client.js";
import {
  assertLeadershipLead,
  assertManagesTeam,
  canSeeFullProfile,
  isExecutive,
  isInvestorOnly,
  isLeadershipLead,
  isManagerRole,
  managesTeam,
  sectionsFor,
  teamRoles,
} from "../src/lib/access.js";
import { hashPassword, verifyPassword } from "../src/lib/password.js";
import { loginInput } from "../src/modules/auth/auth.routes.js";
import {
  memberInput,
  teamInput,
  teamQuery,
  teamUpdate,
} from "../src/modules/teams/team.schema.js";
import {
  isTimeZone,
  passwordReset,
  personInput,
  personQuery,
  personUpdate,
} from "../src/modules/people/person.schema.js";
import { as, ids, SESSION_COOKIE, signIn, viewer } from "./helpers/session.js";

// No database: every request here is refused before a query, or Prisma is stubbed.
const app = createApp();
const api = request.agent(app).set("Cookie", SESSION_COOKIE);
afterEach(() => vi.restoreAllMocks());
afterAll(() => prisma.$disconnect());

const id = ids.devs;
const id2 = ids.other;
const team = { name: "Platform", purpose: "Runs the platform", leadId: id2 };
const person = {
  name: "New Person",
  email: "new@example.com",
  jobTitle: "Software Engineer",
  location: "Pune, India",
  timezone: "Asia/Kolkata",
  teamId: id,
  temporaryPassword: "Temporary#2026",
};

const codeOf = (run: () => void) => {
  try {
    run();
  } catch (error) {
    return error instanceof AppError ? `${error.status} ${error.code}` : error;
  }
  return "allowed";
};

describe("team input", () => {
  it("trims, applies defaults and accepts the documented fields", () => {
    expect(teamInput.parse({ ...team, name: "  Platform  " })).toEqual({
      ...team,
      kind: "TECHNICAL",
      icon: "users",
    });
  });

  it.each([
    ["a one-letter name", { name: "x" }],
    ["an 81-character name", { name: "x".repeat(81) }],
    ["a blank purpose", { purpose: "   " }],
    ["an unknown kind", { kind: "SECRET" }],
    ["an unknown icon", { icon: "not-an-icon" }],
    ["a non-UUID lead", { leadId: "lead-1" }],
    ["a read-only field", { memberCount: 9 }],
    ["the core flag", { isCore: true }],
  ])("rejects %s", (_label, change) => {
    expect(teamInput.safeParse({ ...team, ...change }).success).toBe(false);
  });

  it("allows partial updates but not empty ones", () => {
    expect(teamUpdate.parse({ purpose: " New purpose " })).toEqual({
      purpose: "New purpose",
    });
    expect(teamUpdate.safeParse({}).success).toBe(false);
    expect(teamQuery.parse({})).toEqual({ search: "" });
    expect(memberInput.safeParse({ personId: id2, role: "x" }).success).toBe(
      false,
    );
  });
});

describe("user input", () => {
  it("normalizes email and defaults to office work", () => {
    expect(
      personInput.parse({ ...person, email: "  New.Person@Example.COM " }),
    ).toEqual({
      ...person,
      email: "new.person@example.com",
      workMode: "OFFICE",
    });
  });

  it.each([
    ["an invalid email", { email: "not-an-email" }],
    ["an unknown time zone", { timezone: "Mars/Base" }],
    ["no team", { teamId: undefined }],
    ["a short temporary password", { temporaryPassword: "short" }],
    ["no temporary password", { temporaryPassword: undefined }],
    ["a role (it comes from the team)", { role: "TEAM_MANAGER" }],
    ["a password hash", { passwordHash: "x" }],
  ])("rejects %s", (_label, change) => {
    expect(personInput.safeParse({ ...person, ...change }).success).toBe(false);
  });

  it("allows partial profile updates, status changes and resets", () => {
    expect(personUpdate.parse({ status: "SUSPENDED" })).toEqual({
      status: "SUSPENDED",
    });
    expect(personUpdate.safeParse({}).success).toBe(false);
    expect(personUpdate.safeParse({ teamId: id }).success).toBe(false);
    expect(personUpdate.safeParse({ mustChangePassword: false }).success).toBe(
      false,
    );
    expect(passwordReset.safeParse({ temporaryPassword: "x" }).success).toBe(
      false,
    );
    expect(isTimeZone("Asia/Kolkata")).toBe(true);
    expect(personQuery.safeParse({ limit: "201" }).success).toBe(false);
  });

  it("validates sign-in input", () => {
    expect(
      loginInput.parse({ email: " CEO@Example.com ", password: "x" }),
    ).toEqual({ email: "ceo@example.com", password: "x" });
    expect(loginInput.safeParse({ email: "x", password: "y" }).success).toBe(
      false,
    );
    expect(loginInput.safeParse({ email: "a@b.co" }).success).toBe(false);
  });
});

describe("passwords", () => {
  it("hashes with a salt and verifies only the right password", async () => {
    const [first, second] = await Promise.all([
      hashPassword("Command@2026"),
      hashPassword("Command@2026"),
    ]);
    expect(first).toMatch(/^scrypt\$/);
    expect(first).not.toBe(second);
    expect(await verifyPassword("Command@2026", first)).toBe(true);
    expect(await verifyPassword("command@2026", first)).toBe(false);
    expect(await verifyPassword("Command@2026", "garbage")).toBe(false);
  });
});

describe("roles and access", () => {
  it("gives each team kind a manager role and a member role", () => {
    expect(teamRoles).toEqual({
      LEADERSHIP: { manager: "LEADERSHIP_LEAD", member: "EXECUTIVE_MEMBER" },
      TECHNICAL: { manager: "TEAM_MANAGER", member: "TEAM_MEMBER" },
      BUSINESS: { manager: "SALES_MANAGER", member: "SALES_MEMBER" },
      EXTERNAL: { manager: "INVESTOR_RELATIONS_MANAGER", member: "INVESTOR" },
    });
    expect(isManagerRole("SALES_MANAGER")).toBe(true);
    expect(isManagerRole("EXECUTIVE_MEMBER")).toBe(false);
  });

  it.each([
    ["leadershipLead", ["teams", "finance", "sales", "administration"], []],
    ["executiveMember", ["teams", "finance", "sales"], ["administration"]],
    [
      "teamManager",
      ["teams", "tasks", "engineering", "finance"],
      ["sales", "administration"],
    ],
    [
      "teamMember",
      ["teams", "tasks", "engineering"],
      ["finance", "sales", "administration"],
    ],
    ["salesManager", ["teams", "sales"], ["finance", "engineering"]],
    ["salesMember", ["teams", "sales"], ["projects", "finance"]],
    ["investorRelations", ["teams", "finance"], ["sales", "engineering"]],
    [
      "investor",
      ["overview", "finance", "documents"],
      ["teams", "tasks", "sales", "ai-tools"],
    ],
  ] as const)("%s sees the right sections", (role, allowed, denied) => {
    const sections = sectionsFor(viewer(as[role]));
    for (const section of allowed) expect(sections).toContain(section);
    for (const section of denied) expect(sections).not.toContain(section);
  });

  it("combines the sections of every team a person belongs to", () => {
    const both = sectionsFor(viewer([...as.teamMember, ...as.salesMember]));
    expect(both).toContain("engineering");
    expect(both).toContain("sales");
  });

  it("decides who manages what", () => {
    expect(isLeadershipLead(viewer(as.leadershipLead))).toBe(true);
    expect(isLeadershipLead(viewer(as.executiveMember))).toBe(false);
    expect(isExecutive(viewer(as.executiveMember))).toBe(true);
    expect(managesTeam(viewer(as.leadershipLead), ids.sales)).toBe(true);
    expect(managesTeam(viewer(as.teamManager), ids.devs)).toBe(true);
    expect(managesTeam(viewer(as.teamManager), ids.sales)).toBe(false);
    expect(managesTeam(viewer(as.teamMember), ids.devs)).toBe(false);
    expect(managesTeam(viewer(as.executiveMember), ids.devs)).toBe(false);
    expect(isInvestorOnly(viewer(as.investor))).toBe(true);
    expect(isInvestorOnly(viewer([...as.investor, ...as.teamMember]))).toBe(
      false,
    );
  });

  it("shows full profiles to executives and teammates only", () => {
    expect(canSeeFullProfile(viewer(as.executiveMember), [ids.sales])).toBe(
      true,
    );
    expect(canSeeFullProfile(viewer(as.teamMember), [ids.devs])).toBe(true);
    expect(canSeeFullProfile(viewer(as.teamMember), [ids.sales])).toBe(false);
    expect(canSeeFullProfile(viewer(as.investor), [ids.devs])).toBe(false);
  });

  it("explains refusals", () => {
    expect(
      codeOf(() => assertLeadershipLead(viewer(as.teamManager), "do it")),
    ).toBe("403 FORBIDDEN");
    expect(
      codeOf(() => assertManagesTeam(viewer(as.teamManager), ids.sales)),
    ).toBe("403 FORBIDDEN");
    expect(
      codeOf(() => assertManagesTeam(viewer(as.salesManager), ids.sales)),
    ).toBe("allowed");
  });
});

describe("write routes refuse people without authority before touching data", () => {
  it.each([
    ["teamManager", "POST", "/api/v1/teams", team],
    ["executiveMember", "PATCH", `/api/v1/teams/${id}`, { purpose: "Changed" }],
    ["teamManager", "DELETE", `/api/v1/teams/${id}`, undefined],
    ["teamMember", "POST", `/api/v1/teams/${id}/members`, { personId: id2 }],
    ["salesManager", "DELETE", `/api/v1/teams/${id}/members/${id2}`, undefined],
    ["teamMember", "POST", "/api/v1/people", person],
    ["teamManager", "PATCH", `/api/v1/people/${id2}`, { status: "SUSPENDED" }],
    ["executiveMember", "DELETE", `/api/v1/people/${id2}`, undefined],
  ] as const)("%s: %s %s", async (role, method, path, body) => {
    signIn(as[role]);
    const transaction = vi.spyOn(prisma, "$transaction");
    const req =
      api[method === "POST" ? "post" : method === "PATCH" ? "patch" : "delete"](
        path,
      );
    const res = await (body ? req.send(body) : req);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("validates input before checking authority", async () => {
    signIn(as.teamMember);
    const res = await api.post("/api/v1/teams").send({ name: "x" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect((await api.get("/api/v1/teams/not-a-uuid")).status).toBe(400);
  });
});

describe("database conflicts become clear responses", () => {
  const constraintError = (code: string, modelName: string, index: string) =>
    new Prisma.PrismaClientKnownRequestError("constraint", {
      code,
      clientVersion: "test",
      meta: {
        modelName,
        driverAdapterError: { cause: { constraint: { index } } },
      },
    });
  const removeMember = () => api.delete(`/api/v1/teams/${id}/members/${id2}`);

  it.each([
    [
      "P2002",
      "Team",
      "Team_name_key",
      409,
      "TEAM_NAME_TAKEN",
      "A team with this name already exists.",
    ],
    [
      "P2002",
      "Person",
      "Person_email_key",
      409,
      "EMAIL_TAKEN",
      "Someone already uses this email.",
    ],
    [
      "P2002",
      "TeamMembership",
      "TeamMembership_pkey",
      409,
      "ALREADY_MEMBER",
      "This person is already in the team.",
    ],
    [
      "P2003",
      "Person",
      "Team_leadId_fkey",
      409,
      "PERSON_LEADS_TEAM",
      "This person leads a team. Choose a new team lead first.",
    ],
    [
      "P2003",
      "TeamMembership",
      "TeamMembership_personId_fkey",
      400,
      "UNKNOWN_PERSON",
      "This person no longer exists.",
    ],
    [
      "P2003",
      "TeamMembership",
      "TeamMembership_teamId_fkey",
      400,
      "UNKNOWN_TEAM",
      "This team no longer exists.",
    ],
    [
      "P2002",
      "Team",
      "Team_other_key",
      409,
      "CONFLICT",
      "A team with these details already exists.",
    ],
  ])(
    "names the field for %s on %s (%s)",
    async (prismaCode, model, index, status, code, message) => {
      signIn(as.teamManager);
      vi.spyOn(prisma, "$transaction").mockRejectedValue(
        constraintError(prismaCode, model, index),
      );
      const res = await removeMember();
      expect(res.status).toBe(status);
      expect(res.body.error).toMatchObject({ code, message });
    },
  );

  const driverConflict = () =>
    Object.assign(new Error("TransactionWriteConflict"), {
      name: "DriverAdapterError",
      cause: { kind: "TransactionWriteConflict", originalCode: "40001" },
    });

  it("retries a conflicting transaction, then reports RETRY if it persists", async () => {
    signIn(as.leadershipLead);
    const deletePerson = () => api.delete(`/api/v1/people/${id2}`);
    const transaction = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValueOnce(driverConflict())
      .mockResolvedValueOnce(undefined);
    expect((await deletePerson()).status).toBe(204);
    expect(transaction).toHaveBeenCalledTimes(2);

    transaction.mockReset().mockRejectedValue(driverConflict());
    const res = await deletePerson();
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("RETRY");
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it("hides unexpected errors behind a 500", async () => {
    signIn(as.teamManager);
    vi.spyOn(prisma, "$transaction").mockRejectedValue(new Error("boom"));
    const res = await removeMember();
    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(JSON.stringify(res.body)).not.toContain("boom");
  });

  it("runs check-then-write rules in a serializable transaction", async () => {
    signIn(as.teamManager);
    const transaction = vi
      .spyOn(prisma, "$transaction")
      .mockRejectedValue(new AppError(409, "LAST_TEAM", "x"));
    await removeMember();
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });
});
