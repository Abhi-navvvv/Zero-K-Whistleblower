import type { EncryptedMessage } from "@zk-whistleblower/shared/src/messaging";
import { prisma } from "./client";
import type { Prisma } from "@prisma/client";

export async function listMessages(threadId: string): Promise<EncryptedMessage[]> {
    const rows = await prisma.message.findMany({
        where: { threadId },
        orderBy: [{ timestamp: "asc" }, { createdAt: "asc" }],
        select: {
            sender: true,
            nonce: true,
            ciphertext: true,
            timestamp: true,
        },
    });

    return rows.map((row) => ({
        from: row.sender === "ADMIN" ? "admin" : "reporter",
        nonce: row.nonce,
        ciphertext: row.ciphertext,
        timestamp: row.timestamp.toISOString(),
    }));
}

export async function appendMessage(threadId: string, message: EncryptedMessage): Promise<void> {
    const timestamp = new Date(message.timestamp);

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.messageThread.upsert({
            where: { id: threadId },
            create: {
                id: threadId,
                lastMessageAt: timestamp,
            },
            update: {
                lastMessageAt: timestamp,
                status: "ACTIVE",
            },
        });

        await tx.message.create({
            data: {
                threadId,
                sender: message.from === "admin" ? "ADMIN" : "REPORTER",
                nonce: message.nonce,
                ciphertext: message.ciphertext,
                timestamp,
                deliveredAt: timestamp,
            },
        });
    });
}

export async function markThreadMessagesRead(threadId: string, sender: "admin" | "reporter"): Promise<number> {
    const senderFilter = sender === "admin" ? "ADMIN" : "REPORTER";
    const result = await prisma.message.updateMany({
        where: {
            threadId,
            sender: senderFilter,
            deliveryState: {
                not: "READ",
            },
        },
        data: {
            deliveryState: "READ",
            readAt: new Date(),
        },
    });

    return result.count;
}

export async function archiveThread(threadId: string): Promise<void> {
    await prisma.messageThread.update({
        where: { id: threadId },
        data: {
            status: "ARCHIVED",
            archivedAt: new Date(),
        },
    });
}

export async function restoreThread(threadId: string): Promise<void> {
    await prisma.messageThread.upsert({
        where: { id: threadId },
        create: {
            id: threadId,
            status: "ACTIVE",
            lastMessageAt: new Date(),
        },
        update: {
            status: "ACTIVE",
            archivedAt: null,
        },
    });
}

export async function getThreadSummary(threadId: string) {
    const thread = await prisma.messageThread.findUnique({
        where: { id: threadId },
        select: {
            id: true,
            status: true,
            lastMessageAt: true,
            archivedAt: true,
            createdAt: true,
            updatedAt: true,
            _count: {
                select: {
                    messages: true,
                },
            },
        },
    });

    return thread;
}