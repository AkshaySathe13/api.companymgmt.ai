import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type TestAgent from "supertest/lib/agent.js";
import { createApp } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";
import { fixtures, PASSWORD, signInAs } from "./helpers/users.js";

// A small company with every role, built fresh for this run and removed afterwards.
const app = createApp();
const f = fixtures();
type Agent = InstanceType<typeof TestAgent>;
type User = Awaited<ReturnType<typeof f.user>>;

let ceo: User, cfo: User, mgr: User, dev: User, dev2: User, otherMgr: User;
let otherDev: User, irm: User, investor: User;
let leadership: { id: string }, devTeam: { id: string };
let otherTeam: { id: string }, investors: { id: string };
let as: Record<"ceo" | "cfo" | "mgr" | "dev" | "otherDev" | "investor", Agent>;

beforeAll(async () => {
  [ceo, cfo, mgr, dev, dev2, otherMgr, otherDev, irm, investor] =
    await Promise.all([
      f.user("CEO"),
      f.user("CFO"),
      f.user("Manager"),
      f.user("Developer"),
      f.user("Developer Two"),
      f.user("Other Manager"),
      f.user("Other Developer"),
      f.user("Relations"),
      f.user("Investor", { workMode: "EXTERNAL" }),
    ]);
  leadership = await f.team("Leadership", "LEADERSHIP", ceo, [cfo]);
  devTeam = await f.team("Devs", "TECHNICAL", mgr, [dev, dev2]);
  otherTeam = await f.team("Others", "TECHNICAL", otherMgr, [otherDev]);
  investors = await f.team("Investors", "EXTERNAL", irm, [investor]);
  as = {
    ceo: await signInAs(app, ceo),
    cfo: await signInAs(app, cfo),
    mgr: await signInAs(app, mgr),
    dev: await signInAs(app, dev),
    otherDev: await signInAs(app, otherDev),
    investor: await signInAs(app, investor),
  };
});

afterAll(async () => {
  await f.cleanup();
  await prisma.$disconnect();
});

const errorCode = (res: request.Response) => res.body.error?.code;

describe("sign-in and sessions", () => {
  it("refuses wrong passwords and unknown emails with the same message", async () => {
    const wrong = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: dev.email, password: "not-the-password" });
    const unknown = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: `nobody.${f.suffix}@example.com`, password: PASSWORD });
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({
        code: "INVALID_CREDENTIALS",
        message: "Email or password is incorrect.",
      });
      expect(res.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("sets an HTTP-only session cookie and describes the user", async () => {
    const res = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: ` ${mgr.email.toUpperCase()} `, password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = String(res.headers["set-cookie"]);
    expect(cookie).toMatch(/cc_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(res.body.data).toMatchObject({
      id: mgr.id,
      mustChangePassword: false,
      memberships: [
        { teamId: devTeam.id, role: "TEAM_MANAGER", roleLabel: "Team Manager" },
      ],
      permissions: { administer: false, managedTeamIds: [devTeam.id] },
    });
    expect(res.body.data.sections).toContain("engineering");
    expect(res.body.data.sections).not.toContain("administration");
    expect(JSON.stringify(res.body)).not.toContain("passwordHash");
  });

  it("signs out, and refuses expired sessions", async () => {
    const agent = await signInAs(app, dev2);
    expect((await agent.get("/api/v1/auth/me")).status).toBe(200);
    expect((await agent.post("/api/v1/auth/logout")).status).toBe(204);
    expect((await agent.get("/api/v1/auth/me")).status).toBe(401);
    expect((await agent.get("/api/v1/teams")).status).toBe(401);

    const again = await signInAs(app, dev2);
    await prisma.session.updateMany({
      where: { personId: dev2.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(errorCode(await again.get("/api/v1/teams"))).toBe("UNAUTHENTICATED");
  });

  it("makes new users replace their temporary password first", async () => {
    const created = await as.mgr.post("/api/v1/people").send({
      name: `Newcomer ${f.suffix}`,
      email: `newcomer.${f.suffix}@example.com`,
      jobTitle: "Software Engineer",
      location: "Pune, India",
      timezone: "Asia/Kolkata",
      teamId: devTeam.id,
      temporaryPassword: "Temporary#2026",
    });
    expect(created.status).toBe(201);
    f.personIds.add(created.body.data.id);
    expect(created.body.data.teams).toEqual([
      expect.objectContaining({ id: devTeam.id, role: "TEAM_MEMBER" }),
    ]);

    const newcomer = await signInAs(
      app,
      { email: `newcomer.${f.suffix}@example.com` },
      "Temporary#2026",
    );
    expect(
      (await newcomer.get("/api/v1/auth/me")).body.data.mustChangePassword,
    ).toBe(true);
    expect(errorCode(await newcomer.get("/api/v1/teams"))).toBe(
      "PASSWORD_CHANGE_REQUIRED",
    );
    expect(
      errorCode(
        await newcomer
          .post("/api/v1/auth/password")
          .send({ currentPassword: "wrong", newPassword: "Brand-new#2026" }),
      ),
    ).toBe("WRONG_PASSWORD");
    expect(
      (
        await newcomer.post("/api/v1/auth/password").send({
          currentPassword: "Temporary#2026",
          newPassword: "Temporary#2026",
        })
      ).status,
    ).toBe(400);
    const changed = await newcomer.post("/api/v1/auth/password").send({
      currentPassword: "Temporary#2026",
      newPassword: "Brand-new#2026",
    });
    expect(changed.body.data.mustChangePassword).toBe(false);
    expect((await newcomer.get("/api/v1/teams")).status).toBe(200);
    const oldLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({
        email: `newcomer.${f.suffix}@example.com`,
        password: "Temporary#2026",
      });
    expect(oldLogin.status).toBe(401);
  });

  it("suspension signs a user out everywhere and blocks sign-in", async () => {
    const victim = await f.user("Suspended");
    await prisma.teamMembership.create({
      data: { teamId: devTeam.id, personId: victim.id, role: "TEAM_MEMBER" },
    });
    const session = await signInAs(app, victim);
    const suspend = await as.ceo
      .patch(`/api/v1/people/${victim.id}`)
      .send({ status: "SUSPENDED" });
    expect(suspend.body.data.status).toBe("SUSPENDED");
    expect((await session.get("/api/v1/teams")).status).toBe(401);
    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: victim.email, password: PASSWORD });
    expect(login.status).toBe(403);
    expect(errorCode(login)).toBe("ACCOUNT_SUSPENDED");

    await as.ceo
      .patch(`/api/v1/people/${victim.id}`)
      .send({ status: "ACTIVE" });
    expect((await signInAs(app, victim)).get).toBeTruthy();
  });
});

describe("what each role can see", () => {
  it("shows teammates in full and other teams by name and title only", async () => {
    const teammate = (await as.dev.get(`/api/v1/people/${dev2.id}`)).body.data;
    expect(teammate).toMatchObject({ restricted: false, email: dev2.email });

    const outsider = (await as.dev.get(`/api/v1/people/${otherDev.id}`)).body
      .data;
    expect(outsider).toMatchObject({
      name: otherDev.name,
      jobTitle: otherDev.jobTitle,
      restricted: true,
      email: null,
      location: null,
      timezone: null,
      workMode: null,
      status: null,
    });

    const team = (await as.dev.get(`/api/v1/teams/${otherTeam.id}`)).body.data;
    expect(
      team.members.every((m: { workMode: unknown }) => m.workMode === null),
    ).toBe(true);
    expect(
      team.members.map((m: { roleLabel: string }) => m.roleLabel).sort(),
    ).toEqual(["Team Manager", "Team Member"]);
  });

  it("does not let hidden fields match a search", async () => {
    const byEmail = await as.dev.get(
      `/api/v1/people?search=${encodeURIComponent(otherDev.email)}`,
    );
    expect(byEmail.body.data).toEqual([]);
    const byName = await as.dev.get(
      `/api/v1/people?search=${encodeURIComponent(otherDev.name)}`,
    );
    expect(byName.body.data.map((p: { id: string }) => p.id)).toEqual([
      otherDev.id,
    ]);
  });

  it("shows executives every profile in full", async () => {
    const outsider = (await as.cfo.get(`/api/v1/people/${otherDev.id}`)).body
      .data;
    expect(outsider).toMatchObject({
      restricted: false,
      email: otherDev.email,
    });
  });

  it("keeps investors to their own team", async () => {
    const teams = (await as.investor.get("/api/v1/teams")).body.data;
    expect(teams.map((t: { id: string }) => t.id)).toEqual([investors.id]);
    expect((await as.investor.get(`/api/v1/teams/${devTeam.id}`)).status).toBe(
      404,
    );
    expect((await as.investor.get(`/api/v1/people/${dev.id}`)).status).toBe(
      404,
    );
    const people = (await as.investor.get("/api/v1/people?limit=200")).body
      .data;
    expect(people.map((p: { id: string }) => p.id).sort()).toEqual(
      [irm.id, investor.id].sort(),
    );
    const me = (await as.investor.get("/api/v1/auth/me")).body.data;
    expect(me.sections).not.toContain("teams");
  });
});

describe("who can change what", () => {
  it("lets a manager manage only their own team's members", async () => {
    const add = (agent: Agent, teamId: string, personId: string) =>
      agent.post(`/api/v1/teams/${teamId}/members`).send({ personId });
    const added = await add(as.mgr, devTeam.id, otherDev.id);
    expect(added.status).toBe(201);
    expect(
      added.body.data.members.find((m: { id: string }) => m.id === otherDev.id)
        .role,
    ).toBe("TEAM_MEMBER");
    expect(
      (
        await as.mgr.delete(
          `/api/v1/teams/${devTeam.id}/members/${otherDev.id}`,
        )
      ).status,
    ).toBe(200);

    expect(errorCode(await add(as.mgr, otherTeam.id, dev.id))).toBe(
      "FORBIDDEN",
    );
    expect(errorCode(await add(as.dev, devTeam.id, otherDev.id))).toBe(
      "FORBIDDEN",
    );
    expect(errorCode(await add(as.cfo, devTeam.id, otherDev.id))).toBe(
      "FORBIDDEN",
    );
    const elsewhere = await as.mgr.post("/api/v1/people").send({
      name: `Stray ${f.suffix}`,
      email: `stray.${f.suffix}@example.com`,
      jobTitle: "Software Engineer",
      location: "Pune, India",
      timezone: "Asia/Kolkata",
      teamId: otherTeam.id,
      temporaryPassword: "Temporary#2026",
    });
    expect(errorCode(elsewhere)).toBe("FORBIDDEN");
  });

  it("lets a manager edit and reset their members, but not managers or themselves", async () => {
    const edit = (agent: Agent, id: string) =>
      agent.patch(`/api/v1/people/${id}`).send({ jobTitle: "Senior Engineer" });
    expect((await edit(as.mgr, dev2.id)).body.data.jobTitle).toBe(
      "Senior Engineer",
    );
    expect(errorCode(await edit(as.mgr, otherMgr.id))).toBe("FORBIDDEN");
    expect(errorCode(await edit(as.mgr, mgr.id))).toBe("FORBIDDEN");
    expect(errorCode(await edit(as.dev, dev2.id))).toBe("FORBIDDEN");
    expect(
      errorCode(
        await as.mgr
          .patch(`/api/v1/people/${dev2.id}`)
          .send({ status: "SUSPENDED" }),
      ),
    ).toBe("FORBIDDEN");

    const session = await signInAs(app, dev2);
    const reset = await as.mgr
      .post(`/api/v1/people/${dev2.id}/password`)
      .send({ temporaryPassword: "Reset#Password1" });
    expect(reset.status).toBe(204);
    expect((await session.get("/api/v1/teams")).status).toBe(401);
    const fresh = await signInAs(app, dev2, "Reset#Password1");
    expect(errorCode(await fresh.get("/api/v1/teams"))).toBe(
      "PASSWORD_CHANGE_REQUIRED",
    );
  });

  it("only the Leadership Lead manages teams, and lead changes move the roles", async () => {
    const body = {
      name: `Platform ${f.suffix}`,
      purpose: "Runs it",
      leadId: otherMgr.id,
    };
    expect(errorCode(await as.cfo.post("/api/v1/teams").send(body))).toBe(
      "FORBIDDEN",
    );
    const created = await as.ceo.post("/api/v1/teams").send(body);
    expect(created.status).toBe(201);
    f.teamIds.add(created.body.data.id);
    const id = created.body.data.id;
    await as.ceo
      .post(`/api/v1/teams/${id}/members`)
      .send({ personId: otherDev.id });

    const moved = await as.ceo
      .patch(`/api/v1/teams/${id}`)
      .send({ leadId: otherDev.id });
    const roleOf = (personId: string) =>
      moved.body.data.members.find((m: { id: string }) => m.id === personId)
        .role;
    expect(roleOf(otherDev.id)).toBe("TEAM_MANAGER");
    expect(roleOf(otherMgr.id)).toBe("TEAM_MEMBER");

    const business = await as.ceo
      .patch(`/api/v1/teams/${id}`)
      .send({ kind: "BUSINESS" });
    expect(
      business.body.data.members.map((m: { role: string }) => m.role).sort(),
    ).toEqual(["SALES_MANAGER", "SALES_MEMBER"]);

    const events = await prisma.auditEvent.findMany({
      where: { targetType: "team", targetId: id },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.action)).toEqual([
      "team.created",
      "team.updated",
      "team.updated",
    ]);
    expect(events[0]!.actorId).toBe(ceo.id);

    await as.ceo.patch(`/api/v1/teams/${id}`).send({ leadId: otherMgr.id });
    expect((await as.ceo.delete(`/api/v1/teams/${id}`)).status).toBe(204);
  });

  it("only the Leadership Lead deletes users, never themselves or a lead", async () => {
    const temp = await f.user("Temp");
    await prisma.teamMembership.create({
      data: { teamId: devTeam.id, personId: temp.id, role: "TEAM_MEMBER" },
    });
    expect(errorCode(await as.mgr.delete(`/api/v1/people/${temp.id}`))).toBe(
      "FORBIDDEN",
    );
    expect(errorCode(await as.ceo.delete(`/api/v1/people/${ceo.id}`))).toBe(
      "FORBIDDEN",
    );
    expect(errorCode(await as.ceo.delete(`/api/v1/people/${mgr.id}`))).toBe(
      "PERSON_LEADS_TEAM",
    );
    expect((await as.ceo.delete(`/api/v1/people/${temp.id}`)).status).toBe(204);
  });
});

describe("membership rules", () => {
  it("keeps leads in their team and everyone in at least one team", async () => {
    const remove = (teamId: string, personId: string) =>
      as.ceo.delete(`/api/v1/teams/${teamId}/members/${personId}`);
    expect(errorCode(await remove(devTeam.id, mgr.id))).toBe(
      "LEAD_CANNOT_LEAVE",
    );
    expect(errorCode(await remove(devTeam.id, dev.id))).toBe("LAST_TEAM");
    expect(errorCode(await as.ceo.delete(`/api/v1/teams/${devTeam.id}`))).toBe(
      "TEAM_HAS_ONLY_MEMBERS",
    );
  });

  it("never leaves anyone without a team under concurrent removals", async () => {
    for (let round = 0; round < 3; round++) {
      const racer = await f.user(`Racer${round}`);
      await prisma.teamMembership.createMany({
        data: [
          { teamId: devTeam.id, personId: racer.id, role: "TEAM_MEMBER" },
          { teamId: otherTeam.id, personId: racer.id, role: "TEAM_MEMBER" },
        ],
      });
      const results = await Promise.all(
        [devTeam.id, otherTeam.id].map((teamId) =>
          as.ceo.delete(`/api/v1/teams/${teamId}/members/${racer.id}`),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        await prisma.teamMembership.count({ where: { personId: racer.id } }),
      ).toBe(1);
    }
  });
});

describe("leadership", () => {
  it("lets the CEO see the leadership team and administration", async () => {
    const me = (await as.ceo.get("/api/v1/auth/me")).body.data;
    expect(me.permissions.administer).toBe(true);
    expect(me.sections).toContain("administration");
    expect(me.memberships[0]).toMatchObject({
      teamId: leadership.id,
      roleLabel: "Leadership Lead",
    });
  });
});
