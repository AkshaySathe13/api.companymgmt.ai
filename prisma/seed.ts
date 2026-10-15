import { prisma } from "../src/lib/prisma.js";

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

// Fixed IDs keep the frontend's demo preview roles stable across reseeds.
const personId = (n: number) =>
  `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const teamId = (n: number) =>
  `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`;

type WorkMode = "OFFICE" | "REMOTE" | "EXTERNAL";
const people: [number, string, string, string, string, WorkMode][] = [
  [
    1,
    "Evan Ross",
    "Chief executive officer",
    "New York, US",
    "America/New_York",
    "REMOTE",
  ],
  [
    2,
    "Kavya Rao",
    "Chief financial officer",
    "Pune, India",
    "Asia/Kolkata",
    "OFFICE",
  ],
  [
    3,
    "Arjun Mehta",
    "Chief technology officer",
    "Bengaluru, India",
    "Asia/Kolkata",
    "REMOTE",
  ],
  [
    4,
    "Mira Sen",
    "Engineering manager",
    "Pune, India",
    "Asia/Kolkata",
    "OFFICE",
  ],
  [
    5,
    "Nina Patel",
    "Frontend developer",
    "Pune, India",
    "Asia/Kolkata",
    "OFFICE",
  ],
  [
    6,
    "Karan Desai",
    "Backend developer",
    "Pune, India",
    "Asia/Kolkata",
    "OFFICE",
  ],
  [
    7,
    "Aditi Kulkarni",
    "Full-stack developer",
    "Goa, India",
    "Asia/Kolkata",
    "REMOTE",
  ],
  [8, "Rohan Iyer", "QA engineer", "Pune, India", "Asia/Kolkata", "OFFICE"],
  [
    9,
    "Noah Reed",
    "Lead AI engineer",
    "Austin, US",
    "America/Chicago",
    "OFFICE",
  ],
  [10, "Priya Raman", "AI engineer", "Austin, US", "America/Chicago", "OFFICE"],
  [
    11,
    "Daniel Kim",
    "ML operations engineer",
    "Seattle, US",
    "America/Los_Angeles",
    "REMOTE",
  ],
  [
    12,
    "Omar Lane",
    "Agent integration engineer",
    "Austin, US",
    "America/Chicago",
    "OFFICE",
  ],
  [
    13,
    "Riya Mehta",
    "Head of sales",
    "Mumbai, India",
    "Asia/Kolkata",
    "OFFICE",
  ],
  [
    14,
    "Isha Roy",
    "Sales associate",
    "Mumbai, India",
    "Asia/Kolkata",
    "OFFICE",
  ],
  [
    15,
    "Jake Turner",
    "Account executive",
    "Chicago, US",
    "America/Chicago",
    "REMOTE",
  ],
  [
    16,
    "David Hart",
    "Partner, Northbridge Ventures",
    "London, UK",
    "Europe/London",
    "EXTERNAL",
  ],
  [
    17,
    "Elena Park",
    "Angel investor",
    "Singapore",
    "Asia/Singapore",
    "EXTERNAL",
  ],
];

const teams = [
  {
    n: 1,
    name: "C-suite",
    purpose: "Company leadership: CEO, CFO and CTO.",
    kind: "LEADERSHIP",
    icon: "briefcase",
    lead: 1,
    members: [1, 2, 3],
  },
  {
    n: 2,
    name: "India developers",
    purpose: "Product engineering for the CarrierOS platform.",
    kind: "TECHNICAL",
    icon: "code",
    lead: 4,
    members: [4, 5, 6, 7, 8],
  },
  {
    n: 3,
    name: "US AI engineers",
    purpose: "AI dispatch agent, models and evaluation.",
    kind: "TECHNICAL",
    icon: "sparkles",
    lead: 9,
    members: [9, 10, 11, 12, 3, 7],
  },
  {
    n: 4,
    name: "Sales",
    purpose: "Pipeline, pilots and customer accounts.",
    kind: "BUSINESS",
    icon: "megaphone",
    lead: 13,
    members: [13, 14, 15],
  },
  {
    n: 5,
    name: "Investors",
    purpose: "External investors with approved information only.",
    kind: "EXTERNAL",
    icon: "trending",
    lead: 1,
    members: [16, 17, 1],
  },
] as const;

const emailFor = (name: string, external: boolean) =>
  `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@${external ? "investor.example" : "carrieros.example"}`;

try {
  for (const company of companies)
    await prisma.company.upsert({
      where: { id: company.id },
      update: {},
      create: company,
    });
  for (const [n, name, role, location, timezone, workMode] of people) {
    const external = workMode === "EXTERNAL";
    await prisma.person.upsert({
      where: { id: personId(n) },
      update: {},
      create: {
        id: personId(n),
        name,
        role,
        location,
        timezone,
        workMode,
        kind: external ? "EXTERNAL" : "STAFF",
        email: emailFor(name, external),
      },
    });
  }
  for (const team of teams) {
    await prisma.team.upsert({
      where: { id: teamId(team.n) },
      update: { isCore: true },
      create: {
        id: teamId(team.n),
        isCore: true,
        name: team.name,
        purpose: team.purpose,
        kind: team.kind,
        icon: team.icon,
        leadId: personId(team.lead),
      },
    });
    for (const member of team.members)
      await prisma.teamMembership.upsert({
        where: {
          teamId_personId: {
            teamId: teamId(team.n),
            personId: personId(member),
          },
        },
        update: {},
        create: { teamId: teamId(team.n), personId: personId(member) },
      });
  }
  console.log(
    `Seeded ${companies.length} companies, ${people.length} people and ${teams.length} teams (fictional)`,
  );
} finally {
  await prisma.$disconnect();
}
