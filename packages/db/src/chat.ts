import { prisma } from "./client";

export async function registerAdminChatKey(
  adminAddress: string,
  publicKeyJwk: string,
  signature: string
) {
  return prisma.adminChatKey.upsert({
    where: { adminAddress: adminAddress.toLowerCase() },
    update: { publicKeyJwk, signature },
    create: {
      adminAddress: adminAddress.toLowerCase(),
      publicKeyJwk,
      signature,
    },
  });
}

export async function getAdminChatKeys(adminAddresses: string[]) {
  const normalized = adminAddresses.map((a) => a.toLowerCase());
  return prisma.adminChatKey.findMany({
    where: {
      adminAddress: {
        in: normalized,
      },
    },
  });
}

export async function postAdminChatMessage(
  consensusRequestId: string,
  senderAddress: string,
  senderPseudonym: string,
  ciphertext: string,
  iv: string,
  encryptedKeys: Record<string, string>
) {
  return prisma.adminChatMessage.create({
    data: {
      consensusRequestId,
      senderAddress: senderAddress.toLowerCase(),
      senderPseudonym,
      ciphertext,
      iv,
      encryptedKeys: encryptedKeys as any,
    },
  });
}

export async function getAdminChatMessages(consensusRequestId: string) {
  return prisma.adminChatMessage.findMany({
    where: { consensusRequestId },
    orderBy: { createdAt: "asc" },
  });
}
