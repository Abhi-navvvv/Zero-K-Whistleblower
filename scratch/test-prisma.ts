import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const req = await prisma.reportConsensusRequest.findFirst({
        orderBy: { createdAt: 'desc' }
    });
    console.log(JSON.stringify(req, (key, value) => typeof value === 'bigint' ? value.toString() : value, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
