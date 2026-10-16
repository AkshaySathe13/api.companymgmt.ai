import { vi } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import type { Membership, Viewer } from "../../src/lib/access.js";

// Unit tests run without a database: these stand in for a signed-in session.

export const SESSION_COOKIE = "cc_session=test-token";

export const ids = {
  me: "aaaaaaaa-0000-4000-8000-000000000001",
  other: "aaaaaaaa-0000-4000-8000-000000000002",
  cSuite: "bbbbbbbb-0000-4000-8000-000000000001",
  devs: "bbbbbbbb-0000-4000-8000-000000000002",
  ai: "bbbbbbbb-0000-4000-8000-000000000003",
  sales: "bbbbbbbb-0000-4000-8000-000000000004",
  investors: "bbbbbbbb-0000-4000-8000-000000000005",
};

/** Ready-made memberships for each role in the role table. */
export const as = {
  leadershipLead: [
    { teamId: ids.cSuite, teamKind: "LEADERSHIP", role: "LEADERSHIP_LEAD" },
  ],
  executiveMember: [
    { teamId: ids.cSuite, teamKind: "LEADERSHIP", role: "EXECUTIVE_MEMBER" },
  ],
  teamManager: [
    { teamId: ids.devs, teamKind: "TECHNICAL", role: "TEAM_MANAGER" },
  ],
  teamMember: [
    { teamId: ids.devs, teamKind: "TECHNICAL", role: "TEAM_MEMBER" },
  ],
  salesManager: [
    { teamId: ids.sales, teamKind: "BUSINESS", role: "SALES_MANAGER" },
  ],
  salesMember: [
    { teamId: ids.sales, teamKind: "BUSINESS", role: "SALES_MEMBER" },
  ],
  investorRelations: [
    {
      teamId: ids.investors,
      teamKind: "EXTERNAL",
      role: "INVESTOR_RELATIONS_MANAGER",
    },
  ],
  investor: [{ teamId: ids.investors, teamKind: "EXTERNAL", role: "INVESTOR" }],
} satisfies Record<string, Membership[]>;

export const viewer = (memberships: Membership[], id = ids.me): Viewer => ({
  id,
  name: "Test User",
  memberships,
});

/** Makes the session lookup return a signed-in user with these memberships. */
export function signIn(
  memberships: Membership[],
  options: { mustChangePassword?: boolean; status?: string } = {},
) {
  return vi.spyOn(prisma.session, "findUnique").mockResolvedValue({
    id: "session-hash",
    personId: ids.me,
    createdAt: new Date(),
    lastSeenAt: new Date(),
    expiresAt: new Date(Date.now() + 3_600_000),
    person: {
      id: ids.me,
      name: "Test User",
      status: options.status ?? "ACTIVE",
      mustChangePassword: options.mustChangePassword ?? false,
      passwordHash: null,
      memberships: memberships.map((m) => ({
        teamId: m.teamId,
        role: m.role,
        team: { kind: m.teamKind },
      })),
    },
  } as never);
}
