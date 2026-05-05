import { prisma } from './src/client';

function canonicalAddress(address: string): string {
    return address.toLowerCase();
}

function normalizeConsensusAdmins(addresses: string[]): string[] {
    return Array.from(new Set(addresses.map((address) => canonicalAddress(address).trim()).filter(Boolean))).sort();
}

async function main() {
    const id = "6e095046-1867-4fe0-90b5-2063b2758d6d";
    const request = await (prisma as any).reportConsensusRequest.findUnique({
      where: { id },
      select: { selectedAdmins: true, metadata: true, status: true },
    });
    
    console.log("Raw selectedAdmins:", request.selectedAdmins);
    console.log("Type of selectedAdmins:", typeof request.selectedAdmins);
    console.log("Is Array:", Array.isArray(request.selectedAdmins));
    try {
        const normalized = normalizeConsensusAdmins(request.selectedAdmins ?? []);
        console.log("Normalized:", normalized);
    } catch (e) {
        console.error("Error normalizing:", e);
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
