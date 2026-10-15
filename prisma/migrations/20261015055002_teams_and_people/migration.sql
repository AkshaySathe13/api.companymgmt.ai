-- CreateEnum
CREATE TYPE "PersonKind" AS ENUM ('STAFF', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "WorkMode" AS ENUM ('OFFICE', 'REMOTE', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "TeamKind" AS ENUM ('LEADERSHIP', 'TECHNICAL', 'BUSINESS', 'EXTERNAL');

-- CreateTable
CREATE TABLE "Person" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "role" VARCHAR(120) NOT NULL,
    "location" VARCHAR(120) NOT NULL,
    "timezone" VARCHAR(60) NOT NULL,
    "workMode" "WorkMode" NOT NULL DEFAULT 'OFFICE',
    "kind" "PersonKind" NOT NULL DEFAULT 'STAFF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "purpose" VARCHAR(240) NOT NULL,
    "kind" "TeamKind" NOT NULL DEFAULT 'TECHNICAL',
    "icon" VARCHAR(20) NOT NULL DEFAULT 'users',
    "leadId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMembership" (
    "teamId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMembership_pkey" PRIMARY KEY ("teamId","personId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Person_email_key" ON "Person"("email");

-- CreateIndex
CREATE INDEX "Person_name_idx" ON "Person"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");

-- CreateIndex
CREATE INDEX "TeamMembership_personId_idx" ON "TeamMembership"("personId");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMembership" ADD CONSTRAINT "TeamMembership_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
