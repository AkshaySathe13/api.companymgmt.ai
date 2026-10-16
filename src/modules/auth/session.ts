import { createHash, randomBytes } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors.js";
import type { Viewer } from "../../lib/access.js";

export const SESSION_COOKIE = "cc_session";
const SESSION_HOURS = 12;

declare module "express-serve-static-core" {
  interface Request {
    /** The signed-in person, set by `authenticate`. */
    viewer?: Viewer;
    sessionId?: string;
  }
}

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

/** Starts a session and returns the token for the cookie. Only its hash is stored. */
export async function createSession(personId: string) {
  const token = randomBytes(32).toString("base64url");
  await prisma.session.create({
    data: {
      id: hashToken(token),
      personId,
      expiresAt: new Date(Date.now() + SESSION_HOURS * 3_600_000),
    },
  });
  return token;
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 3_600_000,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

function readToken(req: Request) {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

/** Signs the person out everywhere, e.g. after suspension or a password reset. */
export function revokeSessions(personId: string, exceptId?: string) {
  return prisma.session.deleteMany({
    where: { personId, ...(exceptId ? { id: { not: exceptId } } : {}) },
  });
}

/** Loads the person behind the session cookie; also used by /auth/me. */
export async function loadSession(req: Request) {
  const token = readToken(req);
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: {
      person: {
        include: {
          memberships: { include: { team: { select: { kind: true } } } },
        },
      },
    },
  });
  if (!session) return null;
  if (session.expiresAt <= new Date() || session.person.status !== "ACTIVE") {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }
  return session;
}

/**
 * Requires a signed-in, active person and attaches them as `req.viewer`. Roles are read on
 * every request, so role changes take effect immediately. People with a temporary password can
 * only use the auth routes until they set their own.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  const session = await loadSession(req);
  if (!session)
    throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
  if (session.person.mustChangePassword)
    throw new AppError(
      403,
      "PASSWORD_CHANGE_REQUIRED",
      "Set a new password before continuing.",
    );
  req.viewer = {
    id: session.person.id,
    name: session.person.name,
    memberships: session.person.memberships.map((m) => ({
      teamId: m.teamId,
      teamKind: m.team.kind,
      role: m.role,
    })),
  };
  req.sessionId = session.id;
  next();
}

/** The authenticated viewer; routes behind `authenticate` always have one. */
export function viewerOf(req: Request): Viewer {
  if (!req.viewer)
    throw new AppError(401, "UNAUTHENTICATED", "Please sign in to continue.");
  return req.viewer;
}
