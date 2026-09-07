-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPERADMIN', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "VpsStatus" AS ENUM ('PENDING', 'PROVISIONING', 'ACTIVE', 'ERROR');

-- CreateEnum
CREATE TYPE "Environment" AS ENUM ('PRODUCTION', 'STAGING');

-- CreateEnum
CREATE TYPE "TransferDirection" AS ENUM ('UPLOAD', 'DOWNLOAD');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vps" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ipAddress" TEXT NOT NULL,
    "sshPort" INTEGER NOT NULL DEFAULT 22,
    "sshUser" TEXT NOT NULL,
    "sshPrivateKeyEnc" TEXT NOT NULL,
    "env" "Environment" NOT NULL DEFAULT 'PRODUCTION',
    "group" TEXT NOT NULL,
    "status" "VpsStatus" NOT NULL DEFAULT 'PENDING',
    "provisionLog" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "vpsId" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_transfer_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vpsId" TEXT NOT NULL,
    "direction" "TransferDirection" NOT NULL,
    "remotePath" TEXT NOT NULL,
    "fileSize" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_transfer_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminal_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vpsId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "commandLog" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "terminal_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "vps_name_key" ON "vps"("name");

-- CreateIndex
CREATE INDEX "vps_env_group_idx" ON "vps"("env", "group");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_vpsId_idx" ON "audit_logs"("vpsId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "file_transfer_logs_vpsId_idx" ON "file_transfer_logs"("vpsId");

-- CreateIndex
CREATE INDEX "terminal_sessions_vpsId_idx" ON "terminal_sessions"("vpsId");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_vpsId_fkey" FOREIGN KEY ("vpsId") REFERENCES "vps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_transfer_logs" ADD CONSTRAINT "file_transfer_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_transfer_logs" ADD CONSTRAINT "file_transfer_logs_vpsId_fkey" FOREIGN KEY ("vpsId") REFERENCES "vps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_vpsId_fkey" FOREIGN KEY ("vpsId") REFERENCES "vps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
