import { expect } from "chai";
import { network } from "hardhat";
import {
    initPoseidon,
    poseidonHash,
    buildMerkleTree,
    generateProof,
    formatProofForContract,
} from "./fixtures/setup.js";

const { ethers } = await network.connect();

function cidBytes(cid: string): `0x${string}` {
    return ethers.hexlify(ethers.toUtf8Bytes(cid));
}

describe("WhistleblowerRegistry consensus anchoring", function () {
    let registry: any;
    let owner: any;
    let admin1: any;
    let admin2: any;
    let admin3: any;
    let verifier: any;
    let tree: ReturnType<typeof buildMerkleTree>;
    const secrets = [123456789n, 987654321n, 555555555n];
    const externalNullifier = 42n;

    before(async function () {
        this.timeout(60000);
        await initPoseidon();
        [owner, admin1, admin2, admin3] = await ethers.getSigners();
        tree = buildMerkleTree(secrets.map((s) => poseidonHash([s])));
        verifier = await ethers.deployContract("Groth16Verifier");
        registry = await ethers.deployContract("WhistleblowerRegistry", [await verifier.getAddress()]);
        // add a dummy root so submitReport works
        await registry.addRoot(tree.root);
        await registry.grantOrgAdmin(0, admin1.address);
        await registry.grantOrgAdmin(0, admin2.address);
        await registry.grantOrgAdmin(0, admin3.address);
    });

    it("should allow anchoring a consensus with aggregated signatures", async function () {
        this.timeout(120000);

        const { proof, publicSignals, nullifierHash } = await generateProof(secrets[0], tree, 0, externalNullifier);
        const { pA, pB, pC } = await formatProofForContract(proof, publicSignals);

        const tx = await registry.submitReport(pA, pB, pC, tree.root, nullifierHash, externalNullifier, cidBytes("QmAnchorCID"), 0);
        await tx.wait();
        const reportId = 0n;

        // assign admins
        await registry.assignReportToAdmins(reportId, [admin1.address, admin2.address, admin3.address]);

        // prepare commitment
        const decision = 1; // APPROVED
        const timestamp = Math.floor(Date.now() / 1000);
        const chainId = 31337n;
        const commitment = ethers.keccak256(ethers.solidityPacked(["uint256", "uint8", "uint256", "uint256"], [reportId, decision, timestamp, chainId]));

        // admins sign
        const sig1 = await admin1.signMessage(ethers.getBytes(commitment));
        const sig2 = await admin2.signMessage(ethers.getBytes(commitment));
        const sig3 = await admin3.signMessage(ethers.getBytes(commitment));

        // anchorConsensus requires supermajority of assigned (3) -> 3 signatures required
        await expect(registry.anchorConsensus(reportId, decision, timestamp, commitment, [admin1.address, admin2.address, admin3.address], [sig1, sig2, sig3]))
            .to.emit(registry, "ReportConsensusFinalized");

        const status = await registry.reportConsensusStatus(reportId);
        expect(Number(status)).to.equal(1); // APPROVED
    });

    it("should reject re-anchoring a finalized consensus", async function () {
        this.timeout(120000);

        const { proof, publicSignals, nullifierHash } = await generateProof(secrets[1], tree, 1, externalNullifier);
        const { pA, pB, pC } = await formatProofForContract(proof, publicSignals);

        const tx = await registry.submitReport(pA, pB, pC, tree.root, nullifierHash, externalNullifier, cidBytes("QmReplayCID"), 0);
        await tx.wait();
        const reportId = 1n;

        await registry.assignReportToAdmins(reportId, [admin1.address, admin2.address, admin3.address]);

        const decision = 1;
        const timestamp = Math.floor(Date.now() / 1000);
        const chainId = 31337n;
        const commitment = ethers.keccak256(ethers.solidityPacked(["uint256", "uint8", "uint256", "uint256"], [reportId, decision, timestamp, chainId]));

        const sig1 = await admin1.signMessage(ethers.getBytes(commitment));
        const sig2 = await admin2.signMessage(ethers.getBytes(commitment));
        const sig3 = await admin3.signMessage(ethers.getBytes(commitment));

        await registry.anchorConsensus(reportId, decision, timestamp, commitment, [admin1.address, admin2.address, admin3.address], [sig1, sig2, sig3]);

        const replayTimestamp = timestamp + 1;
        const replayCommitment = ethers.keccak256(ethers.solidityPacked(["uint256", "uint8", "uint256", "uint256"], [reportId, 2, replayTimestamp, chainId]));
        const replaySig1 = await admin1.signMessage(ethers.getBytes(replayCommitment));
        const replaySig2 = await admin2.signMessage(ethers.getBytes(replayCommitment));
        const replaySig3 = await admin3.signMessage(ethers.getBytes(replayCommitment));

        await expect(
            registry.anchorConsensus(reportId, 2, replayTimestamp, replayCommitment, [admin1.address, admin2.address, admin3.address], [replaySig1, replaySig2, replaySig3])
        ).to.be.rejected;
    });
});
