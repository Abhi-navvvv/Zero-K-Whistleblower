/*
  Warnings:

  - A unique constraint covering the columns `[consensusRequestId,adminAddress]` on the table `AdminConsensusVote` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "AdminConsensusVote_consensusRequestId_adminAddress_key" ON "AdminConsensusVote"("consensusRequestId", "adminAddress");
