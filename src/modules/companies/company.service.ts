import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { companyInput, companyUpdate, companyQuery } from "./company.schema.js";
import type { z } from "zod";
import type { Prisma } from "../../generated/prisma/client.js";

export const companyService = {
  async list(query: z.infer<typeof companyQuery>) {
    const where: Prisma.CompanyWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: "insensitive" } },
              { industry: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [data, total] = await prisma.$transaction([
      prisma.company.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
      prisma.company.count({ where }),
    ]);
    return {
      data,
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        pages: Math.ceil(total / query.limit),
      },
    };
  },
  async get(id: string) {
    const company = await prisma.company.findUnique({ where: { id } });
    if (!company) throw new AppError(404, "NOT_FOUND", "Company not found");
    return company;
  },
  create(data: z.infer<typeof companyInput>) {
    return prisma.company.create({ data });
  },
  update(id: string, data: z.infer<typeof companyUpdate>) {
    return prisma.company.update({ where: { id }, data });
  },
};
