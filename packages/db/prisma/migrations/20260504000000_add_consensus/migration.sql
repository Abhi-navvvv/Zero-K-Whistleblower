-- CreateEnum
CREATE TYPE "ConsensusStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'ESCALATED', 'TIMEOUT');

-- CreateEnum
CREATE TYPE "AdminVote" AS ENUM ('APPROVE', 'REJECT', 'ESCALATE', 'ABSTAIN');

-- CreateTable
CREATE TABLE "ReportConsensusRequest" (
    "id" TEXT NOT NULL,
    "onChainReportId" BIGINT,
    "reporterThreadId" TEXT,
    "selectedAdmins" TEXT[] NOT NULL DEFAULT '{}',
    "status" "ConsensusStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    CONSTRAINT "ReportConsensusRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminConsensusVote" (
    "id" TEXT NOT NULL,
    "consensusRequestId" TEXT NOT NULL,
    "adminAddress" TEXT NOT NULL,
    "vote" "AdminVote" NOT NULL,
    "reason" TEXT,
    "encryptedReason" TEXT,
    "votedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signature" TEXT,
    CONSTRAINT "AdminConsensusVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminDecision" (
    "id" TEXT NOT NULL,
    "consensusRequestId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actionMetadata" JSONB,
    "decidedByConsensus" INTEGER,
    "executedAt" TIMESTAMP(3),
    "executedBy" TEXT,
    CONSTRAINT "AdminDecision_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "ReportConsensusRequest_onChainReportId_idx" ON "ReportConsensusRequest"("onChainReportId");
CREATE INDEX "ReportConsensusRequest_status_createdAt_idx" ON "ReportConsensusRequest"("status", "createdAt");
CREATE INDEX "AdminConsensusVote_consensus_admin_idx" ON "AdminConsensusVote"("consensusRequestId", "adminAddress");
CREATE INDEX "AdminConsensusVote_admin_votedAt_idx" ON "AdminConsensusVote"("adminAddress", "votedAt");

-- Foreign Keys
ALTER TABLE "AdminConsensusVote" ADD CONSTRAINT "AdminConsensusVote_consensus_fkey" FOREIGN KEY ("consensusRequestId") REFERENCES "ReportConsensusRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminDecision" ADD CONSTRAINT "AdminDecision_consensus_fkey" FOREIGN KEY ("consensusRequestId") REFERENCES "ReportConsensusRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
