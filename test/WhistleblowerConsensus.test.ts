import { expect } from "chai";
import { network } from "hardhat";

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

    before(async function () {
        this.timeout(20000);
        [owner, admin1, admin2, admin3] = await ethers.getSigners();
        verifier = await ethers.deployContract("Groth16Verifier");
        registry = await ethers.deployContract("WhistleblowerRegistry", [await verifier.getAddress()]);
        // add a dummy root so submitReport works
        await registry.addRoot(12345n);
    });

    it("should allow anchoring a consensus with aggregated signatures", async function () {
        // submit a dummy report (skip proof verification by calling submitReportForOrg via owner with dummy proof?)
        // For end-to-end we just call submitReport by constructing minimal valid proof using zeros will fail; instead emulate push to reports array directly via low-level: call submitReport's effects by calling submitReport with a valid proof created elsewhere. Simpler: push directly by interacting with storage via contract method is not possible. Instead, we call submitReport normally using a small fake proof that the verifier contract will accept in test (Groth16Verifier is a test stub that returns true in test deploy)

        const fakeEncrypted = cidBytes("QmAnchorCID");
        // create minimal proof values
        const pA = [0, 0];
        const pB = [[0, 0], [0, 0]];
        const pC = [0, 0];
        const root = 12345n;
        const nullifierHash = 9999n;
        const externalNullifier = 42n;

        const tx = await registry.submitReport(pA, pB, pC, root, nullifierHash, externalNullifier, fakeEncrypted, 0);
        const receipt = await tx.wait();
        const reportId = 0;

        // assign admins
        await registry.assignReportToAdmins(reportId, [admin1.address, admin2.address, admin3.address]);

        // prepare commitment
        const decision = 1; // APPROVED
        const timestamp = Math.floor(Date.now() / 1000);
        const chainId = (await ethers.getNetwork()).chainId;
        const commitment = ethers.keccak256(ethers.solidityPacked(["uint256", "uint8", "uint256", "uint256"], [reportId, decision, timestamp, chainId]));

        // admins sign
        const sig1 = await admin1.signMessage(ethers.arrayify(commitment));
        const sig2 = await admin2.signMessage(ethers.arrayify(commitment));

        // anchorConsensus requires majority of assigned (3) -> 2 signatures suffice
        await expect(registry.anchorConsensus(reportId, decision, timestamp, commitment, [admin1.address, admin2.address], [sig1, sig2]))
            .to.emit(registry, "ReportConsensusFinalized");

        const status = await registry.reportConsensusStatus(reportId);
        expect(Number(status)).to.equal(1); // APPROVED
    });
});
