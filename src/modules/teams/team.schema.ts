import { z } from "zod";

export const teamKinds = [
  "LEADERSHIP",
  "TECHNICAL",
  "BUSINESS",
  "EXTERNAL",
] as const;
// Icon keys the frontend knows how to draw.
export const teamIcons = [
  "users",
  "briefcase",
  "code",
  "sparkles",
  "megaphone",
  "trending",
  "server",
  "shield",
] as const;

const fields = {
  name: z.string().trim().min(2).max(80),
  purpose: z.string().trim().min(2).max(240),
  kind: z.enum(teamKinds),
  icon: z.enum(teamIcons),
  leadId: z.uuid(),
};

export const teamInput = z
  .object({
    ...fields,
    kind: fields.kind.default("TECHNICAL"),
    icon: fields.icon.default("users"),
  })
  .strict();

export const teamUpdate = z
  .object(fields)
  .partial()
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one field",
  );

export const teamQuery = z
  .object({ search: z.string().trim().max(80).default("") })
  .strict();

export const memberInput = z.object({ personId: z.uuid() }).strict();

export const teamId = z.uuid();
