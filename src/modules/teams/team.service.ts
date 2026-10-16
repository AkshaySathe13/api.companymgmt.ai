import type { z } from "zod";
import { prisma, serializable } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import {
  assertLeadershipLead,
  assertManagesTeam,
  canSeeFullProfile,
  isInvestorOnly,
  roleLabels,
  teamIdsOf,
  teamRoles,
  type Viewer,
} from "../../lib/access.js";
import type { Prisma, TeamKind } from "../../generated/prisma/client.js";
import { teamInput, teamQuery, teamUpdate } from "./team.schema.js";

type Db = Prisma.TransactionClient;

const teamInclude = {
  lead: { select: { id: true, name: true, jobTitle: true } },
  memberships: {
    include: {
      person: {
        select: {
          id: true,
          name: true,
          jobTitle: true,
          workMode: true,
          memberships: { select: { teamId: true } },
        },
      },
    },
    orderBy: { person: { name: "asc" } },
  },
} satisfies Prisma.TeamInclude;

type TeamRow = Prisma.TeamGetPayload<{ include: typeof teamInclude }>;

/** A team as `viewer` may see it: work mode only for people whose full profile they can see. */
export function toTeam(row: TeamRow, viewer: Viewer) {
  const { memberships, ...team } = row;
  return {
    ...team,
    memberCount: memberships.length,
    members: memberships.map(({ person, role }) => {
      const full = canSeeFullProfile(
        viewer,
        person.memberships.map((m) => m.teamId),
      );
      return {
        id: person.id,
        name: person.name,
        jobTitle: person.jobTitle,
        role,
        roleLabel: roleLabels[role],
        workMode: full ? person.workMode : null,
      };
    }),
  };
}

/** Investors only see their own teams; everyone else sees the whole directory. */
function visibleTeams(viewer: Viewer): Prisma.TeamWhereInput {
  return isInvestorOnly(viewer) ? { id: { in: teamIdsOf(viewer) } } : {};
}

async function findTeam(db: Db, id: string, viewer?: Viewer) {
  const row = await db.team.findFirst({
    // AND keeps the visibility filter from replacing the id condition.
    where: { AND: [{ id }, viewer ? visibleTeams(viewer) : {}] },
    include: teamInclude,
  });
  if (!row) throw new AppError(404, "NOT_FOUND", "Team not found");
  return row;
}

async function assertNameFree(db: Db, name: string, exceptId?: string) {
  const existing = await db.team.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (existing && existing.id !== exceptId)
    throw new AppError(
      409,
      "TEAM_NAME_TAKEN",
      "A team with this name already exists.",
    );
}

// Teams are led by staff; external contacts such as investors can be members but not leads.
async function assertLead(db: Db, id: string) {
  const person = await db.person.findUnique({ where: { id } });
  if (!person) throw new AppError(400, "UNKNOWN_PERSON", "Person not found");
  if (person.kind !== "STAFF")
    throw new AppError(
      400,
      "LEAD_MUST_BE_STAFF",
      `${person.name} is an external contact and can't lead a team.`,
    );
}

/** Team roles follow the team: the lead holds its manager role, everyone else its member role. */
async function syncRoles(
  db: Db,
  teamId: string,
  kind: TeamKind,
  leadId: string | null,
) {
  const { manager, member } = teamRoles[kind];
  await db.teamMembership.updateMany({
    where: { teamId, ...(leadId ? { personId: { not: leadId } } : {}) },
    data: { role: member },
  });
  if (leadId)
    await db.teamMembership.updateMany({
      where: { teamId, personId: leadId },
      data: { role: manager },
    });
}

export const teamService = {
  async list(viewer: Viewer, query: z.infer<typeof teamQuery>) {
    const rows = await prisma.team.findMany({
      where: {
        AND: [
          visibleTeams(viewer),
          query.search
            ? { name: { contains: query.search, mode: "insensitive" } }
            : {},
        ],
      },
      include: teamInclude,
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return { data: rows.map((row) => toTeam(row, viewer)) };
  },

  async get(viewer: Viewer, id: string) {
    return toTeam(await findTeam(prisma, id, viewer), viewer);
  },

  async create(viewer: Viewer, input: z.infer<typeof teamInput>) {
    assertLeadershipLead(viewer, "create teams");
    const row = await serializable(async (tx) => {
      await assertNameFree(tx, input.name);
      await assertLead(tx, input.leadId);
      const team = await tx.team.create({
        data: {
          ...input,
          memberships: {
            create: {
              personId: input.leadId,
              role: teamRoles[input.kind].manager,
            },
          },
        },
      });
      await audit(tx, {
        actorId: viewer.id,
        action: "team.created",
        targetType: "team",
        targetId: team.id,
        details: { name: team.name, leadId: team.leadId },
      });
      return findTeam(tx, team.id);
    });
    return toTeam(row, viewer);
  },

  async update(viewer: Viewer, id: string, input: z.infer<typeof teamUpdate>) {
    assertLeadershipLead(viewer, "edit teams");
    const row = await serializable(async (tx) => {
      const before = await findTeam(tx, id);
      if (input.name) await assertNameFree(tx, input.name, id);
      if (input.leadId) {
        await assertLead(tx, input.leadId);
        await tx.teamMembership.upsert({
          where: { teamId_personId: { teamId: id, personId: input.leadId } },
          update: {},
          create: {
            teamId: id,
            personId: input.leadId,
            role: teamRoles[input.kind ?? before.kind].member,
          },
        });
      }
      const team = await tx.team.update({ where: { id }, data: input });
      // A new lead or a new team kind changes the team's roles.
      if (input.leadId || input.kind)
        await syncRoles(tx, id, team.kind, team.leadId);
      await audit(tx, {
        actorId: viewer.id,
        action: "team.updated",
        targetType: "team",
        targetId: id,
        details: {
          before: {
            name: before.name,
            kind: before.kind,
            leadId: before.leadId,
          },
          after: { name: team.name, kind: team.kind, leadId: team.leadId },
        },
      });
      return findTeam(tx, id);
    });
    return toTeam(row, viewer);
  },

  async remove(viewer: Viewer, id: string) {
    assertLeadershipLead(viewer, "delete teams");
    await serializable(async (tx) => {
      const team = await findTeam(tx, id);
      // People must keep at least one team, so a team can't take its last members with it.
      const stranded = await tx.person.count({
        where: {
          memberships: { some: { teamId: id }, every: { teamId: id } },
        },
      });
      if (stranded)
        throw new AppError(
          409,
          "TEAM_HAS_ONLY_MEMBERS",
          `${stranded} ${stranded === 1 ? "person has" : "people have"} no other team. Add them to another team before deleting ${team.name}.`,
        );
      await tx.team.delete({ where: { id } });
      await audit(tx, {
        actorId: viewer.id,
        action: "team.deleted",
        targetType: "team",
        targetId: id,
        details: { name: team.name },
      });
    });
  },

  async addMember(viewer: Viewer, id: string, personId: string) {
    assertManagesTeam(viewer, id);
    const row = await serializable(async (tx) => {
      const team = await findTeam(tx, id);
      const person = await tx.person.findUnique({ where: { id: personId } });
      if (!person)
        throw new AppError(400, "UNKNOWN_PERSON", "Person not found");
      const existing = await tx.teamMembership.findUnique({
        where: { teamId_personId: { teamId: id, personId } },
      });
      if (!existing) {
        const role = teamRoles[team.kind].member;
        await tx.teamMembership.create({
          data: { teamId: id, personId, role },
        });
        await audit(tx, {
          actorId: viewer.id,
          action: "membership.added",
          targetType: "person",
          targetId: personId,
          details: { teamId: id, team: team.name, role },
        });
      }
      return findTeam(tx, id);
    });
    return toTeam(row, viewer);
  },

  async removeMember(viewer: Viewer, id: string, personId: string) {
    assertManagesTeam(viewer, id);
    const row = await serializable(async (tx) => {
      const team = await findTeam(tx, id);
      const membership = team.memberships.find((m) => m.personId === personId);
      if (!membership)
        throw new AppError(404, "NOT_FOUND", "This person isn't in the team");
      if (team.leadId === personId)
        throw new AppError(
          409,
          "LEAD_CANNOT_LEAVE",
          "The team lead can't be removed. Choose a new lead first.",
        );
      const teamCount = await tx.teamMembership.count({ where: { personId } });
      if (teamCount <= 1)
        throw new AppError(
          409,
          "LAST_TEAM",
          "Everyone needs at least one team. Add this person to another team first.",
        );
      await tx.teamMembership.delete({
        where: { teamId_personId: { teamId: id, personId } },
      });
      await audit(tx, {
        actorId: viewer.id,
        action: "membership.removed",
        targetType: "person",
        targetId: personId,
        details: { teamId: id, team: team.name, role: membership.role },
      });
      return findTeam(tx, id);
    });
    return toTeam(row, viewer);
  },
};
