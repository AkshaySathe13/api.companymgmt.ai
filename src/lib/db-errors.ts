import { Prisma } from "../generated/prisma/client.js";

type Described = { status: number; code: string; message: string };

// Services check these rules first with friendlier wording; these cover a concurrent change
// that slips between the check and the write, so the message still names the field involved.
const byConstraint: Record<string, Described> = {
  Team_name_key: {
    status: 409,
    code: "TEAM_NAME_TAKEN",
    message: "A team with this name already exists.",
  },
  Person_email_key: {
    status: 409,
    code: "EMAIL_TAKEN",
    message: "Someone already uses this email.",
  },
  TeamMembership_pkey: {
    status: 409,
    code: "ALREADY_MEMBER",
    message: "This person is already in the team.",
  },
  Team_leadId_fkey: {
    status: 409,
    code: "PERSON_LEADS_TEAM",
    message: "This person leads a team. Choose a new team lead first.",
  },
  TeamMembership_personId_fkey: {
    status: 400,
    code: "UNKNOWN_PERSON",
    message: "This person no longer exists.",
  },
  TeamMembership_teamId_fkey: {
    status: 400,
    code: "UNKNOWN_TEAM",
    message: "This team no longer exists.",
  },
};

const notFound: Record<string, string> = {
  Team: "Team not found",
  Person: "Person not found",
  TeamMembership: "This person isn't in the team",
  Company: "Company not found",
};

const label: Record<string, string> = {
  Team: "team",
  Person: "person",
  TeamMembership: "team membership",
  Company: "company",
};

function constraintOf(meta: Record<string, unknown> | undefined) {
  const adapter = meta?.driverAdapterError as
    { cause?: { constraint?: { index?: string } } } | undefined;
  return adapter?.cause?.constraint?.index;
}

/** Turns a known Prisma error into an API error that names the record or field involved. */
export function describePrismaError(error: unknown): Described | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  const meta = error.meta as Record<string, unknown> | undefined;
  const model = typeof meta?.modelName === "string" ? meta.modelName : "";
  const known = byConstraint[constraintOf(meta) ?? ""];
  if (error.code === "P2025")
    return {
      status: 404,
      code: "NOT_FOUND",
      message: notFound[model] ?? "Not found",
    };
  if (error.code === "P2002")
    return (
      known ?? {
        status: 409,
        code: "CONFLICT",
        message: `A ${label[model] ?? "record"} with these details already exists.`,
      }
    );
  if (error.code === "P2003")
    return (
      known ?? {
        status: 409,
        code: "CONFLICT",
        message: `This ${label[model] ?? "record"} is still used elsewhere, so it can't be changed.`,
      }
    );
  return null;
}
