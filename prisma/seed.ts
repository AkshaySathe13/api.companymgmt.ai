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
try {
  for (const company of companies)
    await prisma.company.upsert({
      where: { id: company.id },
      update: {},
      create: company,
    });
  console.log("Seeded two fictional example companies");
} finally {
  await prisma.$disconnect();
}
