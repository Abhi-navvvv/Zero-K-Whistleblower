-- CreateTable
CREATE TABLE "AdminChatKey" (
    "adminAddress" TEXT NOT NULL,
    "publicKeyJwk" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminChatKey_pkey" PRIMARY KEY ("adminAddress")
);

-- CreateTable
CREATE TABLE "AdminChatMessage" (
    "id" TEXT NOT NULL,
    "consensusRequestId" TEXT NOT NULL,
    "senderAddress" TEXT NOT NULL,
    "senderPseudonym" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "encryptedKeys" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminChatMessage_consensusRequestId_createdAt_idx" ON "AdminChatMessage"("consensusRequestId", "createdAt");

-- AddForeignKey
ALTER TABLE "AdminChatMessage" ADD CONSTRAINT "AdminChatMessage_consensusRequestId_fkey" FOREIGN KEY ("consensusRequestId") REFERENCES "ReportConsensusRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
