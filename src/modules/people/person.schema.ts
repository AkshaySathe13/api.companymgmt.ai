import { z } from "zod";

export const workModes = ["OFFICE", "REMOTE", "EXTERNAL"] as const;

const fields = {
  name: z.string().trim().min(2).max(120),
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  role: z.string().trim().min(2).max(120),
  location: z.string().trim().min(2).max(120),
  timezone: z.string().trim().min(2).max(60),
  workMode: z.enum(workModes),
};

export const personInput = z
  .object({
    ...fields,
    workMode: fields.workMode.default("OFFICE"),
    // Every person starts in at least one team; more can be added later.
    teamIds: z.array(z.uuid()).min(1).max(20),
  })
  .strict();

export const personUpdate = z
  .object(fields)
  .partial()
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one field",
  );

export const personQuery = z
  .object({
    search: z.string().trim().max(120).default(""),
    teamId: z.uuid().optional(),
    // Comma-separated IDs, used by AI views to load exactly the records they reference.
    ids: z
      .string()
      .trim()
      .max(4000)
      .optional()
      .transform((value) =>
        value ? value.split(",").map((id) => id.trim()) : undefined,
      )
      .pipe(z.array(z.uuid()).max(100).optional()),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

export const personId = z.uuid();
