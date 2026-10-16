-- People become users who can sign in; their access comes from their role in each team.

-- CreateEnum
CREATE TYPE "PersonStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('LEADERSHIP_LEAD', 'EXECUTIVE_MEMBER', 'TEAM_MANAGER', 'TEAM_MEMBER', 'SALES_MANAGER', 'SALES_MEMBER', 'INVESTOR_RELATIONS_MANAGER', 'INVESTOR');

-- "role" held a job title; the word now means a team role.
ALTER TABLE "Person" RENAME COLUMN "role" TO "jobTitle";

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "passwordHash" VARCHAR(200),
ADD COLUMN     "status" "PersonStatus" NOT NULL DEFAULT 'ACTIVE';

-- Backfill: each lead gets their team's manager role, everyone else its member role.
ALTER TABLE "TeamMembership" ADD COLUMN "role" "TeamRole";
UPDATE "TeamMembership" AS m
SET "role" = (CASE
  WHEN t."kind" = 'LEADERSHIP' AND t."leadId" = m."personId" THEN 'LEADERSHIP_LEAD'
  WHEN t."kind" = 'LEADERSHIP' THEN 'EXECUTIVE_MEMBER'
  WHEN t."kind" = 'TECHNICAL' AND t."leadId" = m."personId" THEN 'TEAM_MANAGER'
  WHEN t."kind" = 'TECHNICAL' THEN 'TEAM_MEMBER'
  WHEN t."kind" = 'BUSINESS' AND t."leadId" = m."personId" THEN 'SALES_MANAGER'
  WHEN t."kind" = 'BUSINESS' THEN 'SALES_MEMBER'
  WHEN t."leadId" = m."personId" THEN 'INVESTOR_RELATIONS_MANAGER'
  ELSE 'INVESTOR'
END)::"TeamRole"
FROM "Team" AS t
WHERE t."id" = m."teamId";
ALTER TABLE "TeamMembership" ALTER COLUMN "role" SET NOT NULL;

-- CreateTable
CREATE TABLE "Session" (
    "id" VARCHAR(64) NOT NULL,
    "personId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "actorId" UUID,
    "action" VARCHAR(60) NOT NULL,
    "targetType" VARCHAR(40) NOT NULL,
    "targetId" UUID NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_personId_idx" ON "Session"("personId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditEvent_targetType_targetId_createdAt_idx" ON "AuditEvent"("targetType", "targetId", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
