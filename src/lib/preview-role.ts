import type { Request } from "express";
import { AppError } from "./errors.js";

// Demo-only stand-in for authentication: the frontend's preview-role switcher sends the role in
// X-Preview-Role. Anyone can set this header, so it is not access control; replace it with real
// identity before exposing the API (see README, Production).
export const previewRoles = ["executive", "manager", "developer"] as const;
export type PreviewRole = (typeof previewRoles)[number];

/** The caller's preview role. Missing or unknown values get the least access. */
export function previewRole(req: Request): PreviewRole {
  const value = req.get("X-Preview-Role")?.trim().toLowerCase();
  return previewRoles.find((role) => role === value) ?? "developer";
}

export function assertCanManage(role: PreviewRole) {
  if (role === "developer")
    throw new AppError(
      403,
      "FORBIDDEN",
      "Your role can view teams but can't change them.",
    );
}
