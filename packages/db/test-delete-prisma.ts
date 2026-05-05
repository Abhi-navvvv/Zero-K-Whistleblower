import { prisma } from './src/client';

async function main() {
    const deleted = await prisma.reportConsensusRequest.deleteMany({
      where: {
        selectedAdmins: { equals: [] }
      }
    });
    console.log("Deleted corrupted requests:", deleted);
}

main().catch(console.error).finally(() => prisma.$disconnect());
