import { z } from "zod";
export const companyInput = z
  .object({
    name: z.string().trim().min(2).max(160),
    email: z
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    website: z
      .union([
        z
          .url()
          .max(2048)
          .refine(
            (value) => /^https?:\/\//.test(value),
            "Use an HTTP or HTTPS URL",
          ),
        z.literal(""),
      ])
      .optional()
      .transform((value) => value || null),
    industry: z.string().trim().min(2).max(100),
  })
  .strict();
export const companyUpdate = companyInput
  .partial()
  .extend({ status: z.enum(["ACTIVE", "ARCHIVED"]).optional() })
  .refine(
    (value) => Object.keys(value).length > 0,
    "Provide at least one field",
  );
export const companyId = z.uuid();
export const companyQuery = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(160).default(""),
    status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  })
  .strict();
