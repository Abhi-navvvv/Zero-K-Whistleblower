import { prisma } from './src/client';

async function main() {
    const all = await prisma.reportConsensusRequest.findMany({
      select: { id: true, onChainReportId: true, selectedAdmins: true },
      orderBy: { createdAt: 'desc' }
    });
    console.dir(all.map(r => ({ ...r, onChainReportId: r.onChainReportId?.toString() })), { depth: null });
}

main().catch(console.error).finally(() => prisma.$disconnect());
