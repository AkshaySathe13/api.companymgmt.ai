-- AlterTable
ALTER TABLE "Team" ADD COLUMN "isCore" BOOLEAN NOT NULL DEFAULT false;

-- The five seeded company teams are core teams.
UPDATE "Team" SET "isCore" = true WHERE "id" IN (
  'bbbbbbbb-0000-4000-8000-000000000001',
  'bbbbbbbb-0000-4000-8000-000000000002',
  'bbbbbbbb-0000-4000-8000-000000000003',
  'bbbbbbbb-0000-4000-8000-000000000004',
  'bbbbbbbb-0000-4000-8000-000000000005'
);
