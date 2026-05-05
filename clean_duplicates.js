import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const votes = await prisma.adminConsensusVote.findMany();
  console.log("Total votes:", votes.length);
  
  const seen = new Set();
  const toDelete = [];
  
  for (const vote of votes) {
    const key = `${vote.consensusRequestId}-${vote.adminAddress}`;
    if (seen.has(key)) {
      toDelete.push(vote.id);
    } else {
      seen.add(key);
    }
  }
  
  console.log("Duplicates to delete:", toDelete.length);
  
  if (toDelete.length > 0) {
    await prisma.adminConsensusVote.deleteMany({
      where: { id: { in: toDelete } }
    });
    console.log("Deleted duplicates.");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
