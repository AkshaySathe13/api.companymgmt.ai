import type { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { teamInput, teamQuery, teamUpdate } from "./team.schema.js";

const personSummary = {
  id: true,
  name: true,
  role: true,
  workMode: true,
} satisfies Prisma.PersonSelect;

const teamInclude = {
  lead: { select: personSummary },
  memberships: {
    include: { person: { select: personSummary } },
    orderBy: { person: { name: "asc" } },
  },
} satisfies Prisma.TeamInclude;

type TeamRow = Prisma.TeamGetPayload<{ include: typeof teamInclude }>;

export function toTeam(row: TeamRow) {
  const { memberships, ...team } = row;
  return {
    ...team,
    memberCount: memberships.length,
    members: memberships.map((membership) => membership.person),
  };
}

async function assertNameFree(name: string, exceptId?: string) {
  const existing = await prisma.team.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
  if (existing && existing.id !== exceptId)
    throw new AppError(409, "TEAM_NAME_TAKEN", "A team with this name exists");
}

async function assertPerson(id: string) {
  const person = await prisma.person.findUnique({ where: { id } });
  if (!person) throw new AppError(400, "UNKNOWN_PERSON", "Person not found");
  return person;
}

export const teamService = {
  async list(query: z.infer<typeof teamQuery>) {
    const rows = await prisma.team.findMany({
      where: query.search
        ? { name: { contains: query.search, mode: "insensitive" } }
        : {},
      include: teamInclude,
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    return { data: rows.map(toTeam) };
  },

  async get(id: string) {
    const row = await prisma.team.findUnique({
      where: { id },
      include: teamInclude,
    });
    if (!row) throw new AppError(404, "NOT_FOUND", "Team not found");
    return toTeam(row);
  },

  async create(input: z.infer<typeof teamInput>) {
    await assertNameFree(input.name);
    await assertPerson(input.leadId);
    // The lead is always a member of the team they lead.
    const row = await prisma.team.create({
      data: { ...input, memberships: { create: { personId: input.leadId } } },
      include: teamInclude,
    });
    return toTeam(row);
  },

  async update(id: string, input: z.infer<typeof teamUpdate>) {
    await this.get(id);
    if (input.name) await assertNameFree(input.name, id);
    if (input.leadId) await assertPerson(input.leadId);
    const row = await prisma.$transaction(async (tx) => {
      if (input.leadId)
        await tx.teamMembership.upsert({
          where: { teamId_personId: { teamId: id, personId: input.leadId } },
          update: {},
          create: { teamId: id, personId: input.leadId },
        });
      return tx.team.update({
        where: { id },
        data: input,
        include: teamInclude,
      });
    });
    return toTeam(row);
  },

  async remove(id: string) {
    const team = await this.get(id);
    // People must keep at least one team, so a team can't take its last members with it.
    const stranded = await prisma.person.count({
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
    await prisma.team.delete({ where: { id } });
  },

  async addMember(id: string, personId: string) {
    await this.get(id);
    await assertPerson(personId);
    await prisma.teamMembership.upsert({
      where: { teamId_personId: { teamId: id, personId } },
      update: {},
      create: { teamId: id, personId },
    });
    return this.get(id);
  },

  async removeMember(id: string, personId: string) {
    const team = await this.get(id);
    if (!team.members.some((member) => member.id === personId))
      throw new AppError(404, "NOT_FOUND", "This person isn't in the team");
    if (team.leadId === personId)
      throw new AppError(
        409,
        "LEAD_CANNOT_LEAVE",
        "The team lead can't be removed. Choose a new lead first.",
      );
    const teamCount = await prisma.teamMembership.count({
      where: { personId },
    });
    if (teamCount <= 1)
      throw new AppError(
        409,
        "LAST_TEAM",
        "Everyone needs at least one team. Add this person to another team first.",
      );
    await prisma.teamMembership.delete({
      where: { teamId_personId: { teamId: id, personId } },
    });
    return this.get(id);
  },
};
