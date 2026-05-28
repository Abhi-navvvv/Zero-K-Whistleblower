import { expect } from "chai";
import { network } from "hardhat";

// @ts-ignore
const { ethers } = await network.connect();

function cidBytes(cid: string): `0x${string}` {
    return ethers.hexlify(ethers.toUtf8Bytes(cid));
}

describe("WhistleblowerRegistry - OIDC Authority Submissions", function () {
    let verifier: any;
    let registry: any;
    let owner: any;
    let authority: any;
    let unauthorized: any;
    let oidcAuthorityRole: string;

    const orgId = 10n;
    const nullifierHash = 987654321n;
    const cid = "QmOidcTestCID123456789";
    const category = 1; // Fraud

    before(async function () {
        [owner, authority, unauthorized] = await ethers.getSigners();

        verifier = await ethers.deployContract("Groth16Verifier");
        registry = await ethers.deployContract("WhistleblowerRegistry", [
            await verifier.getAddress(),
        ]);

        oidcAuthorityRole = await registry.OIDC_AUTHORITY_ROLE();

        // Register organization
        await registry.createOrganization(orgId, "Bennett University");

        // Grant OIDC_AUTHORITY_ROLE to authority
        await registry.grantRole(oidcAuthorityRole, authority.address);
    });

    it("should accept a valid OIDC report signed by an authorized authority", async function () {
        const payloadHash = ethers.solidityPackedKeccak256(
            ["uint256", "uint256", "bytes", "uint8"],
            [orgId, nullifierHash, cidBytes(cid), category]
        );

        // Sign the hash using authority account
        const signature = await authority.signMessage(ethers.getBytes(payloadHash));

        // Submit the report
        const tx = await registry.submitReportWithOidc(
            orgId,
            nullifierHash,
            cidBytes(cid),
            category,
            signature
        );

        await expect(tx)
            .to.emit(registry, "ReportSubmittedForOrg")
            .withArgs(0, orgId, nullifierHash, cidBytes(cid), category, (v: any) => v > 0);

        const report = await registry.getReport(0);
        expect(report.nullifierHash).to.equal(nullifierHash);
        expect(report.merkleRoot).to.equal(0n); // OIDC reports have root = 0
        expect(report.encryptedCID).to.equal(cidBytes(cid));
        expect(report.category).to.equal(category);
    });

    it("should reject double submission of same nullifier", async function () {
        const payloadHash = ethers.solidityPackedKeccak256(
            ["uint256", "uint256", "bytes", "uint8"],
            [orgId, nullifierHash, cidBytes("QmDifferentCid"), category]
        );

        const signature = await authority.signMessage(ethers.getBytes(payloadHash));

        await expect(
            registry.submitReportWithOidc(
                orgId,
                nullifierHash,
                cidBytes("QmDifferentCid"),
                category,
                signature
            )
        ).to.be.revertedWithCustomError(registry, "NullifierAlreadyUsed");
    });

    it("should reject report signed by an unauthorized authority", async function () {
        const nextNullifier = 555555n;
        const payloadHash = ethers.solidityPackedKeccak256(
            ["uint256", "uint256", "bytes", "uint8"],
            [orgId, nextNullifier, cidBytes(cid), category]
        );

        // Sign using unauthorized account
        const signature = await unauthorized.signMessage(ethers.getBytes(payloadHash));

        await expect(
            registry.submitReportWithOidc(
                orgId,
                nextNullifier,
                cidBytes(cid),
                category,
                signature
            )
        ).to.be.revertedWithCustomError(registry, "UnauthorizedOidcAuthority");
    });
});
