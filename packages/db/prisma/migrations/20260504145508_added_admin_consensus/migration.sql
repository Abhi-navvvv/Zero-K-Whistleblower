/*
  Warnings:

  - A unique constraint covering the columns `[consensusRequestId]` on the table `AdminDecision` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "AdminDecision_consensusRequestId_key" ON "AdminDecision"("consensusRequestId");

-- RenameForeignKey
ALTER TABLE "AdminConsensusVote" RENAME CONSTRAINT "AdminConsensusVote_consensus_fkey" TO "AdminConsensusVote_consensusRequestId_fkey";

-- RenameForeignKey
ALTER TABLE "AdminDecision" RENAME CONSTRAINT "AdminDecision_consensus_fkey" TO "AdminDecision_consensusRequestId_fkey";

-- RenameIndex
ALTER INDEX "AdminConsensusVote_admin_votedAt_idx" RENAME TO "AdminConsensusVote_adminAddress_votedAt_idx";

-- RenameIndex
ALTER INDEX "AdminConsensusVote_consensus_admin_idx" RENAME TO "AdminConsensusVote_consensusRequestId_adminAddress_idx";
