import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/lib/password.js";
import { teamRoles } from "../src/lib/access.js";

const companies = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Acme Studio",
    email: "hello@acme.example",
    industry: "Design",
    website: "https://acme.example",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Northstar Labs",
    email: "team@northstar.example",
    industry: "Technology",
    website: "https://northstar.example",
  },
];

// Fixed IDs keep links stable across reseeds.
const personId = (n: number) =>
  `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const teamId = (n: number) =>
  `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Shared password for the seeded demo users, so every role can be tried. Fictional data only. */
export const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? "Pass@123";

type WorkMode = "OFFICE" | "REMOTE" | "EXTERNAL";
// One user per row of the company's team, role and job title table.
const people: {
  n: number;
  email: string;
  name: string;
  jobTitle: string;
  location: string;
  timezone: string;
  workMode: WorkMode;
}[] = [
  {
    n: 1,
    email: "ceo@gmail.com",
    name: "Aarav Shah",
    jobTitle: "CEO",
    location: "Mumbai, India",
    timezone: "Asia/Kolkata",
    workMode: "OFFICE",
  },
  {
    n: 2,
    email: "cfo@gmail.com",
    name: "Meera Iyer",
    jobTitle: "CFO",
    location: "Mumbai, India",
    timezone: "Asia/Kolkata",
    workMode: "OFFICE",
  },
  {
    n: 3,
    email: "cto@gmail.com",
    name: "Daniel Brooks",
    jobTitle: "CTO",
    location: "San Francisco, US",
    timezone: "America/Los_Angeles",
    workMode: "REMOTE",
  },
  {
    n: 4,
    email: "indiamanager@gmail.com",
    name: "Rahul Verma",
    jobTitle: "Engineering Manager",
    location: "Pune, India",
    timezone: "Asia/Kolkata",
    workMode: "OFFICE",
  },
  {
    n: 5,
    email: "indiadeveloper@gmail.com",
    name: "Sneha Kulkarni",
    jobTitle: "Software Engineer",
    location: "Pune, India",
    timezone: "Asia/Kolkata",
    workMode: "OFFICE",
  },
  {
    n: 6,
    email: "usaimanager@gmail.com",
    name: "Olivia Chen",
    jobTitle: "AI Engineering Manager",
    location: "Austin, US",
    timezone: "America/Chicago",
    workMode: "OFFICE",
  },
  {
    n: 7,
    email: "usaiengineer@gmail.com",
    name: "Marcus Lee",
    jobTitle: "AI Engineer",
    location: "Seattle, US",
    timezone: "America/Los_Angeles",
    workMode: "REMOTE",
  },
  {
    n: 8,
    email: "salesmanager@gmail.com",
    name: "Priya Nair",
    jobTitle: "Head of Sales",
    location: "Bengaluru, India",
    timezone: "Asia/Kolkata",
    workMode: "OFFICE",
  },
  {
    n: 9,
    email: "salesexecutive@gmail.com",
    name: "Ethan Walker",
    jobTitle: "Sales Executive",
    location: "London, UK",
    timezone: "Europe/London",
    workMode: "REMOTE",
  },
  {
    n: 10,
    email: "irmanager@gmail.com",
    name: "Sofia Martins",
    jobTitle: "Investor Relations Manager",
    location: "New York, US",
    timezone: "America/New_York",
    workMode: "OFFICE",
  },
  {
    n: 11,
    email: "investor@gmail.com",
    name: "Robert Hayes",
    jobTitle: "Investor",
    location: "Singapore",
    timezone: "Asia/Singapore",
    workMode: "EXTERNAL",
  },
];

// The five core teams. The lead holds the team's manager role; other members its member role.
const teams = [
  {
    n: 1,
    name: "C-suite",
    purpose: "Company leadership: CEO, CFO and CTO.",
    kind: "LEADERSHIP",
    icon: "briefcase",
    lead: 1,
    members: [2, 3],
  },
  {
    n: 2,
    name: "India developers",
    purpose: "Product engineering for the CarrierOS platform.",
    kind: "TECHNICAL",
    icon: "code",
    lead: 4,
    members: [5],
  },
  {
    n: 3,
    name: "US AI engineers",
    purpose: "AI dispatch agent, models and evaluation.",
    kind: "TECHNICAL",
    icon: "sparkles",
    lead: 6,
    members: [7],
  },
  {
    n: 4,
    name: "Sales",
    purpose: "Pipeline, pilots and customer accounts.",
    kind: "BUSINESS",
    icon: "megaphone",
    lead: 8,
    members: [9],
  },
  {
    n: 5,
    name: "Investors",
    purpose: "External investors with approved information only.",
    kind: "EXTERNAL",
    icon: "trending",
    lead: 10,
    members: [11],
  },
] as const;

if (process.env.NODE_ENV === "production")
  throw new Error(
    "The seed replaces all people and teams; never run it in production.",
  );

try {
  for (const company of companies)
    await prisma.company.upsert({
      where: { id: company.id },
      update: {},
      create: company,
    });
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  await prisma.$transaction(async (tx) => {
    // Start fresh: the directory is replaced with the users below.
    await tx.session.deleteMany();
    await tx.teamMembership.deleteMany();
    await tx.team.deleteMany();
    await tx.person.deleteMany();
    for (const person of people)
      await tx.person.create({
        data: {
          id: personId(person.n),
          name: person.name,
          email: person.email,
          jobTitle: person.jobTitle,
          location: person.location,
          timezone: person.timezone,
          workMode: person.workMode,
          kind: person.workMode === "EXTERNAL" ? "EXTERNAL" : "STAFF",
          passwordHash,
          mustChangePassword: false,
        },
      });
    for (const team of teams) {
      const roles = teamRoles[team.kind];
      await tx.team.create({
        data: {
          id: teamId(team.n),
          name: team.name,
          purpose: team.purpose,
          kind: team.kind,
          icon: team.icon,
          isCore: true,
          leadId: personId(team.lead),
          memberships: {
            create: [
              { personId: personId(team.lead), role: roles.manager },
              ...team.members.map((member) => ({
                personId: personId(member),
                role: roles.member,
              })),
            ],
          },
        },
      });
    }
  });
  console.log(
    `Seeded ${companies.length} companies, ${people.length} users and ${teams.length} teams (fictional). Demo password: ${DEMO_PASSWORD}`,
  );
} finally {
  await prisma.$disconnect();
}
