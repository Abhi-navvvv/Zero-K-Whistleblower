-- CreateEnum
CREATE TYPE "MessageSender" AS ENUM ('ADMIN', 'REPORTER');

-- CreateEnum
CREATE TYPE "MessageDeliveryState" AS ENUM ('QUEUED', 'DELIVERED', 'READ');

-- CreateEnum
CREATE TYPE "ThreadStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "MessageThread" (
    "id" TEXT NOT NULL,
    "status" "ThreadStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "sender" "MessageSender" NOT NULL,
    "nonce" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "deliveryState" "MessageDeliveryState" NOT NULL DEFAULT 'DELIVERED',
    "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MessageThread_status_lastMessageAt_idx" ON "MessageThread"("status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Message_threadId_timestamp_idx" ON "Message"("threadId", "timestamp");

-- CreateIndex
CREATE INDEX "Message_sender_timestamp_idx" ON "Message"("sender", "timestamp");

-- CreateIndex
CREATE INDEX "Message_deliveryState_timestamp_idx" ON "Message"("deliveryState", "timestamp");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MessageThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
