import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import {
  hashPassword,
  PASSWORD_MIN_LENGTH,
  timingDummyHash,
  verifyPassword,
} from "../../lib/password.js";
import {
  isLeadershipLead,
  isManagerRole,
  roleLabels,
  sectionsFor,
  type Viewer,
} from "../../lib/access.js";
import {
  clearSessionCookie,
  createSession,
  loadSession,
  revokeSessions,
  setSessionCookie,
} from "./session.js";

export const authRouter = Router();

export const loginInput = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
    password: z.string().min(1).max(200),
  })
  .strict();

export const newPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(200);

const changePasswordInput = z
  .object({ currentPassword: z.string().min(1).max(200), newPassword })
  .strict()
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "Choose a password different from the current one",
    path: ["newPassword"],
  });

// Slows down password guessing: 10 attempts per 15 minutes per address.
const loginLimit = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many sign-in attempts. Try again in 15 minutes.",
    },
  },
});

/** What the frontend needs about the signed-in person: profile, team roles and allowed sections. */
async function describe(personId: string) {
  const person = await prisma.person.findUniqueOrThrow({
    where: { id: personId },
    include: {
      memberships: {
        include: { team: { select: { id: true, name: true, kind: true } } },
        orderBy: { team: { name: "asc" } },
      },
    },
  });
  const viewer: Viewer = {
    id: person.id,
    name: person.name,
    memberships: person.memberships.map((m) => ({
      teamId: m.teamId,
      teamKind: m.team.kind,
      role: m.role,
    })),
  };
  return {
    id: person.id,
    name: person.name,
    email: person.email,
    jobTitle: person.jobTitle,
    mustChangePassword: person.mustChangePassword,
    memberships: person.memberships.map((m) => ({
      teamId: m.team.id,
      teamName: m.team.name,
      teamKind: m.team.kind,
      role: m.role,
      roleLabel: roleLabels[m.role],
    })),
    sections: sectionsFor(viewer),
    permissions: {
      administer: isLeadershipLead(viewer),
      // The Leadership Lead manages every team; others manage the teams they lead.
      managedTeamIds: person.memberships
        .filter((m) => isManagerRole(m.role))
        .map((m) => m.teamId),
    },
  };
}

const invalidCredentials = () =>
  new AppError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");

authRouter.post("/login", loginLimit, async (req, res) => {
  const { email, password } = loginInput.parse(req.body);
  const person = await prisma.person.findUnique({ where: { email } });
  // Check a password even for unknown emails, so timing doesn't reveal which emails exist.
  const valid = await verifyPassword(
    password,
    person?.passwordHash ?? (await timingDummyHash()),
  );
  if (!person?.passwordHash || !valid) throw invalidCredentials();
  if (person.status !== "ACTIVE")
    throw new AppError(
      403,
      "ACCOUNT_SUSPENDED",
      "This account is suspended. Contact your Leadership Lead.",
    );
  setSessionCookie(res, await createSession(person.id));
  res.json({ data: await describe(person.id) });
});

authRouter.post("/logout", async (req, res) => {
  const session = await loadSession(req);
  if (session)
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
  clearSessionCookie(res);
  res.status(204).end();
});

// Allowed while a password change is pending, so the app can show the change-password screen.
authRouter.get("/me", async (req, res) => {
  const session = await loadSession(req);
  if (!session)
    throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
  res.json({ data: await describe(session.personId) });
});

authRouter.post("/password", async (req, res) => {
  const session = await loadSession(req);
  if (!session)
    throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
  const input = changePasswordInput.parse(req.body);
  const hash = session.person.passwordHash;
  if (!hash || !(await verifyPassword(input.currentPassword, hash)))
    throw new AppError(
      400,
      "WRONG_PASSWORD",
      "Your current password is incorrect.",
    );
  await prisma.$transaction(async (tx) => {
    await tx.person.update({
      where: { id: session.personId },
      data: {
        passwordHash: await hashPassword(input.newPassword),
        mustChangePassword: false,
      },
    });
    await audit(tx, {
      actorId: session.personId,
      action: "password.changed",
      targetType: "person",
      targetId: session.personId,
    });
  });
  // Other browsers signed in as this person must sign in again with the new password.
  await revokeSessions(session.personId, session.id);
  res.json({ data: await describe(session.personId) });
});
