import type { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { personInput, personQuery, personUpdate } from "./person.schema.js";

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

export function toPerson(row: PersonRow) {
  const { memberships, ledTeams, ...person } = row;
  return {
    ...person,
    teams: memberships.map((membership) => membership.team),
    leadsTeamIds: ledTeams.map((team) => team.id),
  };
}

async function assertEmailFree(email: string, exceptId?: string) {
  const existing = await prisma.person.findUnique({ where: { email } });
  if (existing && existing.id !== exceptId)
    throw new AppError(409, "EMAIL_TAKEN", "Someone already uses this email");
}

export const personService = {
  async list(query: z.infer<typeof personQuery>) {
    const where: Prisma.PersonWhereInput = {
      ...(query.ids ? { id: { in: query.ids } } : {}),
      ...(query.teamId
        ? { memberships: { some: { teamId: query.teamId } } }
        : {}),
      ...(query.search
        ? {
            OR: (["name", "role", "email", "location"] as const).map(
              (field) => ({
                [field]: { contains: query.search, mode: "insensitive" },
              }),
            ),
          }
        : {}),
    };
    const rows = await prisma.person.findMany({
      where,
      include: personInclude,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: query.limit,
    });
    return { data: rows.map(toPerson) };
  },

  async get(id: string) {
    const row = await prisma.person.findUnique({
      where: { id },
      include: personInclude,
    });
    if (!row) throw new AppError(404, "NOT_FOUND", "Person not found");
    return toPerson(row);
  },

  async create(input: z.infer<typeof personInput>) {
    const { teamIds, ...data } = input;
    const uniqueTeamIds = [...new Set(teamIds)];
    const found = await prisma.team.count({
      where: { id: { in: uniqueTeamIds } },
    });
    if (found !== uniqueTeamIds.length)
      throw new AppError(400, "UNKNOWN_TEAM", "One or more teams don't exist");
    await assertEmailFree(data.email);
    const row = await prisma.person.create({
      data: {
        ...data,
        kind: data.workMode === "EXTERNAL" ? "EXTERNAL" : "STAFF",
        memberships: { create: uniqueTeamIds.map((teamId) => ({ teamId })) },
      },
      include: personInclude,
    });
    return toPerson(row);
  },

  async update(id: string, input: z.infer<typeof personUpdate>) {
    await this.get(id);
    if (input.email) await assertEmailFree(input.email, id);
    const row = await prisma.person.update({
      where: { id },
      data: {
        ...input,
        ...(input.workMode
          ? { kind: input.workMode === "EXTERNAL" ? "EXTERNAL" : "STAFF" }
          : {}),
      },
      include: personInclude,
    });
    return toPerson(row);
  },

  async remove(id: string) {
    const person = await this.get(id);
    if (person.leadsTeamIds.length)
      throw new AppError(
        409,
        "PERSON_LEADS_TEAM",
        `${person.name} leads a team. Choose a new team lead first.`,
      );
    await prisma.person.delete({ where: { id } });
  },
};
