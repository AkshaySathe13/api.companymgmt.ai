import type { TeamKind, TeamRole } from "../generated/prisma/client.js";
import { AppError } from "./errors.js";

/**
 * Role-based access. A person's access comes from their role in each of their teams:
 * the role decides what they can do, and their teams decide whose records it applies to.
 * Every API route checks these rules; the frontend only hides what the API would refuse.
 */

export type Membership = {
  teamId: string;
  teamKind: TeamKind;
  role: TeamRole;
};

/** The signed-in person, as every service sees them. */
export type Viewer = {
  id: string;
  name: string;
  memberships: Membership[];
};

/** Each team kind offers a manager role (held by the team lead) and a member role. */
export const teamRoles: Record<
  TeamKind,
  { manager: TeamRole; member: TeamRole }
> = {
  LEADERSHIP: { manager: "LEADERSHIP_LEAD", member: "EXECUTIVE_MEMBER" },
  TECHNICAL: { manager: "TEAM_MANAGER", member: "TEAM_MEMBER" },
  BUSINESS: { manager: "SALES_MANAGER", member: "SALES_MEMBER" },
  EXTERNAL: { manager: "INVESTOR_RELATIONS_MANAGER", member: "INVESTOR" },
};

export const roleLabels: Record<TeamRole, string> = {
  LEADERSHIP_LEAD: "Leadership Lead",
  EXECUTIVE_MEMBER: "Executive Member",
  TEAM_MANAGER: "Team Manager",
  TEAM_MEMBER: "Team Member",
  SALES_MANAGER: "Sales Manager",
  SALES_MEMBER: "Sales Member",
  INVESTOR_RELATIONS_MANAGER: "Investor Relations Manager",
  INVESTOR: "Investor",
};

/** Suggested job titles for each role, from the company's role table. */
export const jobTitleSuggestions: Record<TeamRole, string[]> = {
  LEADERSHIP_LEAD: ["CEO"],
  EXECUTIVE_MEMBER: ["CFO", "CTO"],
  TEAM_MANAGER: ["Engineering Manager", "AI Engineering Manager"],
  TEAM_MEMBER: ["Software Engineer", "AI Engineer"],
  SALES_MANAGER: ["Head of Sales"],
  SALES_MEMBER: ["Sales Executive"],
  INVESTOR_RELATIONS_MANAGER: ["Investor Relations Manager", "CEO"],
  INVESTOR: ["Investor"],
};

export const isManagerRole = (role: TeamRole) =>
  Object.values(teamRoles).some((pair) => pair.manager === role);

// Sections of the portal (navigation slugs) each role may open.
const everyone = ["overview", "communication"];
const staff = [
  ...everyone,
  "approvals",
  "activity",
  "teams",
  "tasks",
  "ai-tools",
  "documents",
];
const allSections = [
  "overview",
  "approvals",
  "activity",
  "teams",
  "projects",
  "tasks",
  "engineering",
  "qa",
  "infrastructure",
  "ai-tools",
  "communication",
  "sales",
  "finance",
  "documents",
];
export const sectionsByRole: Record<TeamRole, string[]> = {
  LEADERSHIP_LEAD: [...allSections, "administration"],
  EXECUTIVE_MEMBER: allSections,
  TEAM_MANAGER: [
    ...staff,
    "projects",
    "engineering",
    "qa",
    "infrastructure",
    "finance",
  ],
  TEAM_MEMBER: [...staff, "projects", "engineering", "qa", "infrastructure"],
  SALES_MANAGER: [...staff, "projects", "infrastructure", "sales"],
  SALES_MEMBER: [...staff, "infrastructure", "sales"],
  INVESTOR_RELATIONS_MANAGER: [...staff, "finance"],
  INVESTOR: [...everyone, "finance", "documents"],
};

const roles = (viewer: Viewer) => viewer.memberships.map((m) => m.role);

/** CEO: manages every team, user and role. */
export const isLeadershipLead = (viewer: Viewer) =>
  roles(viewer).includes("LEADERSHIP_LEAD");

/** Leadership roles see every team and full profiles company-wide. */
export const isExecutive = (viewer: Viewer) =>
  roles(viewer).some(
    (r) => r === "LEADERSHIP_LEAD" || r === "EXECUTIVE_MEMBER",
  );

/** Investors only see their own teams and the people in them. */
export const isInvestorOnly = (viewer: Viewer) =>
  viewer.memberships.length > 0 &&
  viewer.memberships.every((m) => m.role === "INVESTOR");

export const teamIdsOf = (viewer: Viewer) =>
  viewer.memberships.map((m) => m.teamId);

/** Teams whose membership this person manages: every team for the CEO, else teams they lead. */
export function managesTeam(viewer: Viewer, teamId: string) {
  return (
    isLeadershipLead(viewer) ||
    viewer.memberships.some((m) => m.teamId === teamId && isManagerRole(m.role))
  );
}

/** The sections this person may open: the union of their roles' sections. */
export function sectionsFor(viewer: Viewer) {
  const allowed = new Set(roles(viewer).flatMap((r) => sectionsByRole[r]));
  return allSections.concat("administration").filter((s) => allowed.has(s));
}

/** Full profile (contact details, location) for executives, yourself and your teammates. */
export function canSeeFullProfile(viewer: Viewer, personTeamIds: string[]) {
  if (isExecutive(viewer)) return true;
  const mine = new Set(teamIdsOf(viewer));
  return personTeamIds.some((id) => mine.has(id));
}

const forbidden = (message: string) => new AppError(403, "FORBIDDEN", message);

export function assertLeadershipLead(viewer: Viewer, action: string) {
  if (!isLeadershipLead(viewer))
    throw forbidden(`Only the Leadership Lead can ${action}.`);
}

export function assertManagesTeam(viewer: Viewer, teamId: string) {
  if (!managesTeam(viewer, teamId))
    throw forbidden(
      "Only this team's manager or the Leadership Lead can do this.",
    );
}
