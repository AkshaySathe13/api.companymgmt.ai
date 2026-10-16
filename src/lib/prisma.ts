import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../generated/prisma/client.js";
import { env } from "../config/env.js";
export const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    max: 10,
  }),
});

/** True when Postgres aborted a transaction because a concurrent one conflicted with it. */
export function isWriteConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("code" in error && error.code === "P2034") return true;
  // With the pg driver adapter, conflicts surface as DriverAdapterError with the Postgres code.
  const cause =
    "cause" in error ? (error.cause as Record<string, unknown>) : null;
  return (
    cause?.kind === "TransactionWriteConflict" ||
    cause?.originalCode === "40001" ||
    cause?.originalCode === "40P01"
  );
}

/**
 * Runs check-then-write rules (such as "everyone keeps a team") so concurrent requests can't both
 * pass the check. Postgres aborts the loser of a conflict; it is retried, so it re-reads the new
 * state and gets the normal rule error. If conflicts persist the API answers 409 RETRY.
 */
export async function serializable<T>(
  run: (tx: Prisma.TransactionClient) => Promise<T>,
  attempts = 3,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(run, { isolationLevel: "Serializable" });
    } catch (error) {
      if (attempt >= attempts || !isWriteConflict(error)) throw error;
    }
  }
}
