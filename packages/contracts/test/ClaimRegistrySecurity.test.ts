import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("Claim Registry Security & Vault Integration Suite", function () {
  async function deployFixture() {
    const [owner, vaultSigner, marketSigner, user1, user2, unauthorizedUser] =
      await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();

    const claimRegistry = await hre.viem.deployContract("ClaimRegistry");

    // Configure vault and market addresses in claim registry
    await claimRegistry.write.setVault([vaultSigner.account.address]);
    await claimRegistry.write.setClaimMarket([marketSigner.account.address]);

    return {
      owner,
      vaultSigner,
      marketSigner,
      user1,
      user2,
      unauthorizedUser,
      publicClient,
      claimRegistry,
    };
  }

  it("1. Vault -> Claim Registry creation -> Should create claim with full metadata", async function () {
    const { vaultSigner, user1, claimRegistry } = await deployFixture();

    const tx = await claimRegistry.write.createClaim(
      ["REQ-0001", "RWA-001", user1.account.address, 1000000000n],
      { account: vaultSigner.account }
    );

    const claim = await claimRegistry.read.getClaim([1n]);
    expect(claim.claimId).to.equal(1n);
    expect(claim.requestId).to.equal("REQ-0001");
    expect(claim.assetId).to.equal("RWA-001");
    expect(claim.owner.toLowerCase()).to.equal(user1.account.address.toLowerCase());
    expect(claim.faceValue).to.equal(1000000000n);
    expect(claim.status).to.equal(0); // Active
    expect(claim.metadataHash).to.not.equal("0x0000000000000000000000000000000000000000000000000000000000000000");
  });

  it("2. Duplicate Claim Prevention -> 1 request cannot create duplicate claims", async function () {
    const { vaultSigner, user1, claimRegistry } = await deployFixture();

    await claimRegistry.write.createClaim(
      ["REQ-0002", "RWA-001", user1.account.address, 1000000000n],
      { account: vaultSigner.account }
    );

    // Second claim for same request ID must revert
    await expect(
      claimRegistry.simulate.createClaim(
        ["REQ-0002", "RWA-001", user1.account.address, 1000000000n],
        { account: vaultSigner.account }
      )
    ).to.be.rejectedWith("ClaimAlreadyExists");
  });

  it("3. Double Settlement Prevention -> 1 claim cannot be settled twice", async function () {
    const { vaultSigner, user1, claimRegistry } = await deployFixture();

    await claimRegistry.write.createClaim(
      ["REQ-0003", "RWA-001", user1.account.address, 1000000000n],
      { account: vaultSigner.account }
    );

    await claimRegistry.write.markClaimSettled([1n], { account: vaultSigner.account });

    // Second settlement attempt must revert
    await expect(
      claimRegistry.simulate.markClaimSettled([1n], { account: vaultSigner.account })
    ).to.be.rejectedWith("AlreadyClaimed");
  });

  it("4. Zero Face Value Protection -> Should revert with InvalidAmount", async function () {
    const { vaultSigner, user1, claimRegistry } = await deployFixture();

    await expect(
      claimRegistry.simulate.createClaim(
        ["REQ-0004", "RWA-001", user1.account.address, 0n],
        { account: vaultSigner.account }
      )
    ).to.be.rejectedWith("InvalidAmount");
  });

  it("5. Unauthorized Caller Rejection -> Should revert on unauthorized createClaim", async function () {
    const { unauthorizedUser, user1, claimRegistry } = await deployFixture();

    await expect(
      claimRegistry.simulate.createClaim(
        ["REQ-0005", "RWA-001", user1.account.address, 1000000000n],
        { account: unauthorizedUser.account }
      )
    ).to.be.rejected;
  });

  it("6. Claim Transfer & Ownership Tracking -> Market can transfer claim ownership", async function () {
    const { vaultSigner, marketSigner, user1, user2, claimRegistry } = await deployFixture();

    await claimRegistry.write.createClaim(
      ["REQ-0006", "RWA-001", user1.account.address, 1000000000n],
      { account: vaultSigner.account }
    );

    await claimRegistry.write.transferClaim([1n, user2.account.address], {
      account: marketSigner.account,
    });

    const newOwner = await claimRegistry.read.getClaimOwner([1n]);
    expect(newOwner.toLowerCase()).to.equal(user2.account.address.toLowerCase());

    const claim = await claimRegistry.read.getClaim([1n]);
    expect(claim.status).to.equal(2); // Transferred
  });

  it("7. Settled Claim Non-Transferability -> Settled claims cannot be transferred", async function () {
    const { vaultSigner, marketSigner, user1, user2, claimRegistry } = await deployFixture();

    await claimRegistry.write.createClaim(
      ["REQ-0007", "RWA-001", user1.account.address, 1000000000n],
      { account: vaultSigner.account }
    );

    await claimRegistry.write.markClaimSettled([1n], { account: vaultSigner.account });

    await expect(
      claimRegistry.simulate.transferClaim([1n, user2.account.address], {
        account: marketSigner.account,
      })
    ).to.be.rejectedWith("ClaimNotTransferable");
  });

  it("8. Ownership Unambiguity -> Querying non-existent claim reverts with ClaimNotFound", async function () {
    const { claimRegistry } = await deployFixture();

    await expect(
      claimRegistry.simulate.getClaimOwner([999n])
    ).to.be.rejectedWith("ClaimNotFound");
  });
});
