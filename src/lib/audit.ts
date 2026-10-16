import type { Prisma } from "../generated/prisma/client.js";

/** Records who changed a user, role or access setting, with what changed. */
export function audit(
  db: Prisma.TransactionClient,
  event: {
    actorId: string | null;
    action: string;
    targetType: "person" | "team" | "membership" | "session";
    targetId: string;
    details?: Prisma.InputJsonValue;
  },
) {
  return db.auditEvent.create({
    data: { ...event, details: event.details ?? {} },
  });
}
