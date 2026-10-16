import type { z } from "zod";
import { prisma, serializable } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import { hashPassword } from "../../lib/password.js";
import {
  assertLeadershipLead,
  assertManagesTeam,
  canSeeFullProfile,
  isInvestorOnly,
  isLeadershipLead,
  isManagerRole,
  managesTeam,
  roleLabels,
  teamIdsOf,
  teamRoles,
  type Viewer,
} from "../../lib/access.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { revokeSessions } from "../auth/session.js";
import {
  passwordReset,
  personInput,
  personQuery,
  personUpdate,
} from "./person.schema.js";

type Db = Prisma.TransactionClient;

const personInclude = {
  memberships: {
    include: {
      team: { select: { id: true, name: true, icon: true, kind: true } },
    },
    orderBy: { team: { name: "asc" } },
  },
  ledTeams: { select: { id: true } },
} satisfies Prisma.PersonInclude;

type PersonRow = Prisma.PersonGetPayload<{ include: typeof personInclude }>;

const kindFor = (workMode: string) =>
  workMode === "EXTERNAL" ? "EXTERNAL" : "STAFF";

const forbidden = (message: string) => new AppError(403, "FORBIDDEN", message);

/**
 * A person as `viewer` may see them. Outside their own teams (unless they are an executive),
 * people show only name, job title and teams; contact details, location and status are hidden.
 */
export function toPerson(row: PersonRow, viewer: Viewer) {
  const teamIds = row.memberships.map((m) => m.teamId);
  const full = row.id === viewer.id || canSeeFullProfile(viewer, teamIds);
  const visibleTeamIds = new Set(teamIdsOf(viewer));
  const memberships = isInvestorOnly(viewer)
    ? row.memberships.filter((m) => visibleTeamIds.has(m.teamId))
    : row.memberships;
  return {
    id: row.id,
    name: row.name,
    jobTitle: row.jobTitle,
    kind: row.kind,
    restricted: !full,
    email: full ? row.email : null,
    location: full ? row.location : null,
    timezone: full ? row.timezone : null,
    workMode: full ? row.workMode : null,
    status: full ? row.status : null,
    teams: memberships.map((m) => ({
      ...m.team,
      role: m.role,
      roleLabel: roleLabels[m.role],
    })),
    leadsTeamIds: row.ledTeams.map((team) => team.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Investors only see the people in their own teams. */
function visiblePeople(viewer: Viewer): Prisma.PersonWhereInput {
  return isInvestorOnly(viewer)
    ? { memberships: { some: { teamId: { in: teamIdsOf(viewer) } } } }
    : {};
}

async function findPerson(db: Db, id: string, viewer?: Viewer) {
  const row = await db.person.findFirst({
    where: { AND: [{ id }, viewer ? visiblePeople(viewer) : {}] },
    include: personInclude,
  });
  if (!row) throw new AppError(404, "NOT_FOUND", "Person not found");
  return row;
}

/**
 * The Leadership Lead manages everyone. A team manager manages the members of their team,
 * but not other managers and not themselves.
 */
function assertManagesPerson(viewer: Viewer, row: PersonRow) {
  if (isLeadershipLead(viewer)) return;
  const managed =
    row.id !== viewer.id &&
    row.memberships.some(
      (m) => !isManagerRole(m.role) && managesTeam(viewer, m.teamId),
    );
  if (!managed)
    throw forbidden(
      "Only this person's team manager or the Leadership Lead can do this.",
    );
}

async function assertEmailFree(db: Db, email: string, exceptId?: string) {
  const existing = await db.person.findUnique({ where: { email } });
  if (existing && existing.id !== exceptId)
    throw new AppError(409, "EMAIL_TAKEN", "Someone already uses this email.");
}

export const personService = {
  async list(viewer: Viewer, query: z.infer<typeof personQuery>) {
    const search = query.search.toLowerCase();
    const where: Prisma.PersonWhereInput = {
      AND: [
        visiblePeople(viewer),
        query.ids ? { id: { in: query.ids } } : {},
        query.teamId ? { memberships: { some: { teamId: query.teamId } } } : {},
        search
          ? {
              OR: (["name", "jobTitle", "email", "location"] as const).map(
                (field) => ({
                  [field]: { contains: search, mode: "insensitive" },
                }),
              ),
            }
          : {},
      ],
    };
    const rows = await prisma.person.findMany({
      where,
      include: personInclude,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: query.limit,
    });
    const people = rows.map((row) => toPerson(row, viewer));
    // Hidden fields must not match a search, or the results would reveal them.
    return {
      data: search
        ? people.filter(
            (p) =>
              !p.restricted ||
              `${p.name} ${p.jobTitle}`.toLowerCase().includes(search),
          )
        : people,
    };
  },

  async get(viewer: Viewer, id: string) {
    return toPerson(await findPerson(prisma, id, viewer), viewer);
  },

  /** Creates a user in one team with that team's member role and a temporary password. */
  async create(viewer: Viewer, input: z.infer<typeof personInput>) {
    const { teamId, temporaryPassword, ...data } = input;
    assertManagesTeam(viewer, teamId);
    const passwordHash = await hashPassword(temporaryPassword);
    const row = await serializable(async (tx) => {
      const team = await tx.team.findUnique({ where: { id: teamId } });
      if (!team)
        throw new AppError(400, "UNKNOWN_TEAM", "This team doesn't exist.");
      await assertEmailFree(tx, data.email);
      const role = teamRoles[team.kind].member;
      const person = await tx.person.create({
        data: {
          ...data,
          kind: kindFor(data.workMode),
          passwordHash,
          mustChangePassword: true,
          memberships: { create: { teamId, role } },
        },
      });
      await audit(tx, {
        actorId: viewer.id,
        action: "person.created",
        targetType: "person",
        targetId: person.id,
        details: { email: person.email, teamId, team: team.name, role },
      });
      return findPerson(tx, person.id);
    });
    return toPerson(row, viewer);
  },

  async update(
    viewer: Viewer,
    id: string,
    input: z.infer<typeof personUpdate>,
  ) {
    if (input.status) {
      assertLeadershipLead(viewer, "suspend or reactivate users");
      if (id === viewer.id) throw forbidden("You can't suspend yourself.");
    }
    const row = await serializable(async (tx) => {
      const before = await findPerson(tx, id);
      assertManagesPerson(viewer, before);
      if (input.email) await assertEmailFree(tx, input.email, id);
      if (input.workMode === "EXTERNAL" && before.ledTeams.length)
        throw new AppError(
          409,
          "PERSON_LEADS_TEAM",
          `${before.name} leads a team, so they can't become an external contact. Choose a new team lead first.`,
        );
      await tx.person.update({
        where: { id },
        data: {
          ...input,
          ...(input.workMode ? { kind: kindFor(input.workMode) } : {}),
        },
      });
      const changed = Object.fromEntries(
        Object.entries(input).map(([key, value]) => [
          key,
          { from: before[key as keyof typeof before], to: value },
        ]),
      );
      await audit(tx, {
        actorId: viewer.id,
        action: "person.updated",
        targetType: "person",
        targetId: id,
        details: JSON.parse(JSON.stringify(changed)),
      });
      return findPerson(tx, id);
    });
    // A suspended person is signed out everywhere at once.
    if (input.status === "SUSPENDED") await revokeSessions(id);
    return toPerson(row, viewer);
  },

  async resetPassword(
    viewer: Viewer,
    id: string,
    input: z.infer<typeof passwordReset>,
  ) {
    const passwordHash = await hashPassword(input.temporaryPassword);
    await serializable(async (tx) => {
      assertManagesPerson(viewer, await findPerson(tx, id));
      await tx.person.update({
        where: { id },
        data: { passwordHash, mustChangePassword: true },
      });
      await audit(tx, {
        actorId: viewer.id,
        action: "password.reset",
        targetType: "person",
        targetId: id,
      });
    });
    await revokeSessions(id);
  },

  async remove(viewer: Viewer, id: string) {
    assertLeadershipLead(viewer, "delete users");
    if (id === viewer.id) throw forbidden("You can't delete your own account.");
    await serializable(async (tx) => {
      const person = await findPerson(tx, id);
      if (person.ledTeams.length)
        throw new AppError(
          409,
          "PERSON_LEADS_TEAM",
          `${person.name} leads a team. Choose a new team lead first.`,
        );
      await tx.person.delete({ where: { id } });
      await audit(tx, {
        actorId: viewer.id,
        action: "person.deleted",
        targetType: "person",
        targetId: id,
        details: { name: person.name, email: person.email },
      });
    });
  },
};
