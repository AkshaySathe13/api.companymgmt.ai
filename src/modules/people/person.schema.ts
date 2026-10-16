import { z } from "zod";
import { PASSWORD_MIN_LENGTH } from "../../lib/password.js";

export const workModes = ["OFFICE", "REMOTE", "EXTERNAL"] as const;

export function isTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const temporaryPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(200);

const fields = {
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  jobTitle: z.string().trim().min(2).max(120),
  location: z.string().trim().min(2).max(120),
  timezone: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .refine(isTimeZone, "Use an IANA time zone such as Asia/Kolkata"),
  workMode: z.enum(workModes),
};

export const personInput = z
  .object({
    ...fields,
    workMode: fields.workMode.default("OFFICE"),
    // A user starts in one team with that team's member role; more teams can be added later.
    teamId: z.uuid(),
    temporaryPassword: temporaryPassword,
  })
  .strict();

/** Set by an admin; the person must replace it at their first sign-in. */
export const passwordReset = z.object({ temporaryPassword }).strict();

export const personStatuses = ["ACTIVE", "SUSPENDED"] as const;

export const personUpdate = z
  .object({ ...fields, status: z.enum(personStatuses) })
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
