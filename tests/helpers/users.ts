import request from "supertest";
import type { Express } from "express";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma.js";
import { hashPassword } from "../../src/lib/password.js";
import { teamRoles } from "../../src/lib/access.js";
import type { TeamKind } from "../../src/generated/prisma/client.js";

// Integration-test fixtures: real users with passwords in real teams, signed in through the API.

export const PASSWORD = "Fixture#Password1";

export function fixtures() {
  const suffix = randomUUID().slice(0, 8);
  const personIds = new Set<string>();
  const teamIds = new Set<string>();
  let hash: Promise<string> | undefined;

  async function user(
    name: string,
    options: {
      workMode?: "OFFICE" | "REMOTE" | "EXTERNAL";
      mustChangePassword?: boolean;
    } = {},
  ) {
    hash ??= hashPassword(PASSWORD);
    const workMode = options.workMode ?? "OFFICE";
    const person = await prisma.person.create({
      data: {
        name: `${name} ${suffix}`,
        email: `${name.toLowerCase().replace(/\W+/g, ".")}.${suffix}@example.com`,
        jobTitle: name,
        location: "Pune, India",
        timezone: "Asia/Kolkata",
        workMode,
        kind: workMode === "EXTERNAL" ? "EXTERNAL" : "STAFF",
        passwordHash: await hash,
        mustChangePassword: options.mustChangePassword ?? false,
      },
    });
    personIds.add(person.id);
    return person;
  }

  /** A team led by `lead` (manager role) with `members` (member role). */
  async function team(
    name: string,
    kind: TeamKind,
    lead: { id: string },
    members: { id: string }[] = [],
  ) {
    const roles = teamRoles[kind];
    const created = await prisma.team.create({
      data: {
        name: `${name} ${suffix}`,
        purpose: `${name} work`,
        kind,
        leadId: lead.id,
        memberships: {
          create: [
            { personId: lead.id, role: roles.manager },
            ...members.map((m) => ({ personId: m.id, role: roles.member })),
          ],
        },
      },
    });
    teamIds.add(created.id);
    return created;
  }

  async function cleanup() {
    await prisma.team.deleteMany({ where: { id: { in: [...teamIds] } } });
    await prisma.person.deleteMany({ where: { id: { in: [...personIds] } } });
  }

  return { suffix, user, team, cleanup, personIds, teamIds };
}

/** Signs in through the real login endpoint; the returned agent keeps the session cookie. */
export async function signInAs(
  app: Express,
  person: { email: string },
  password = PASSWORD,
) {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/v1/auth/login")
    .send({ email: person.email, password });
  if (res.status !== 200)
    throw new Error(
      `Sign-in failed (${res.status}): ${JSON.stringify(res.body)}`,
    );
  return agent;
}
