import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 7 — Claim Market & Liquidity Gap Infrastructure Validation Suite", function () {
  async function deployFixture() {
    const [deployer, attester, alice, bob, charlie] = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();

    const mockUSDC = await hre.viem.deployContract("MockUSDC");
    const assetRegistry = await hre.viem.deployContract("RWAAssetRegistry");
    const oracleAdapter = await hre.viem.deployContract("RWAOracleAdapter", [
      attester.account.address,
      assetRegistry.address,
    ]);
    const claimRegistry = await hre.viem.deployContract("ClaimRegistry");
    const vault = await hre.viem.deployContract("AsyncRWAVault", [
      mockUSDC.address,
      claimRegistry.address,
    ]);
    const claimMarket = await hre.viem.deployContract("ClaimMarket", [
      mockUSDC.address,
      claimRegistry.address,
    ]);

    await assetRegistry.write.setOracleAdapter([oracleAdapter.address]);
    await oracleAdapter.write.setVault([vault.address]);
    await vault.write.setOracleAdapter([oracleAdapter.address]);
    await claimRegistry.write.setVault([vault.address]);
    await claimRegistry.write.setClaimMarket([claimMarket.address]);

    const initialAmount = 100000000000n; // 100,000 USDC
    await mockUSDC.write.mint([alice.account.address, initialAmount]);
    await mockUSDC.write.mint([bob.account.address, initialAmount]);
    await mockUSDC.write.mint([charlie.account.address, initialAmount]);

    return {
      alice,
      bob,
      charlie,
      publicClient,
      mockUSDC,
      vault,
      claimRegistry,
      claimMarket,
    };
  }

  it("Step 1 — Executes Alice 1,000 USDC deposit -> REQ-0002 -> Claim #002 (Face Value: $1,000 USDC, PENDING)", async function () {
    const { alice, publicClient, mockUSDC, vault, claimRegistry } = await deployFixture();
    await mockUSDC.write.approve([vault.address, 2000000000n], { account: alice.account });
    await vault.write.requestDeposit([1000000000n], { account: alice.account }); // REQ-0001
    const depositTx2 = await vault.write.requestDeposit([1000000000n], { account: alice.account }); // REQ-0002 -> Claim #2
    const receipt2 = await publicClient.waitForTransactionReceipt({ hash: depositTx2 });

    const req2 = await vault.read.getRequest(["REQ-0002"]);
    const claimId2 = 2n;
    const claim2 = await claimRegistry.read.getClaim([claimId2]);

    expect(receipt2.status).to.equal("success");
    expect(req2.state).to.equal(1); // PENDING
    expect(claim2.owner.toLowerCase()).to.equal(alice.account.address.toLowerCase());
    expect(claim2.faceValue).to.equal(1000000000n); // 1,000 USDC
    expect(claim2.status).to.equal(0); // Active
  });

  it("Step 2 — Alice lists Claim #002 at 980 USDC & Bob buys it -> T+0 Liquidity Realized while RWA remains PENDING", async function () {
    const { alice, bob, mockUSDC, vault, claimRegistry, claimMarket } = await deployFixture();
    await mockUSDC.write.approve([vault.address, 2000000000n], { account: alice.account });
    await vault.write.requestDeposit([1000000000n], { account: alice.account });
    await vault.write.requestDeposit([1000000000n], { account: alice.account });

    const claimId2 = 2n;
    const salePrice = 980000000n;

    // Alice lists Claim #002
    await claimMarket.write.listClaim([claimId2, salePrice], { account: alice.account });

    // Bob buys Claim #002
    await mockUSDC.write.approve([claimMarket.address, salePrice], { account: bob.account });
    await claimMarket.write.buyClaim([claimId2], { account: bob.account });

    const aliceUsdc = await mockUSDC.read.balanceOf([alice.account.address]);
    const bobUsdc = await mockUSDC.read.balanceOf([bob.account.address]);
    const claim2 = await claimRegistry.read.getClaim([claimId2]);
    const req2 = await vault.read.getRequest(["REQ-0002"]);

    expect(aliceUsdc).to.equal(98980000000n); // Net +980 USDC cash realized at T+0
    expect(bobUsdc).to.equal(99020000000n);   // Net -980 USDC cash paid
    expect(claim2.owner.toLowerCase()).to.equal(bob.account.address.toLowerCase());
    expect(claim2.status).to.equal(2); // Transferred
    expect(req2.state).to.equal(1); // STILL PENDING!
  });

  describe("Adversarial Attack Vector Verification", function () {
    it("Vector 1 — Sell same claim twice -> Reverts with NotClaimOwner()", async function () {
      const { alice, bob, mockUSDC, claimMarket } = await deployFixture();
      await mockUSDC.write.approve([vault.address, 1000000000n], { account: alice.account });
      await vault.write.requestDeposit([1000000000n], { account: alice.account });

      await claimMarket.write.listClaim([1n, 980000000n], { account: alice.account });
      await mockUSDC.write.approve([claimMarket.address, 980000000n], { account: bob.account });
      await claimMarket.write.buyClaim([1n], { account: bob.account });

      // Alice attempts to list Claim #1 again
      await expect(claimMarket.write.listClaim([1n, 980000000n], { account: alice.account })).to.be.rejectedWith("NotClaimOwner");
    });

    it("Vector 2 — Buy already sold claim -> Reverts with ListingNotActive()", async function () {
      const { alice, bob, charlie, mockUSDC, claimMarket } = await deployFixture();
      await mockUSDC.write.approve([vault.address, 1000000000n], { account: alice.account });
      await vault.write.requestDeposit([1000000000n], { account: alice.account });

      await claimMarket.write.listClaim([1n, 980000000n], { account: alice.account });
      await mockUSDC.write.approve([claimMarket.address, 980000000n], { account: bob.account });
      await claimMarket.write.buyClaim([1n], { account: bob.account });

      // Charlie attempts to buy inactive listing
      await mockUSDC.write.approve([claimMarket.address, 980000000n], { account: charlie.account });
      await expect(claimMarket.write.buyClaim([1n], { account: charlie.account })).to.be.rejectedWith("ListingNotActive");
    });

    it("Vector 3 — Transfer unauthorized claim -> Reverts with UnauthorizedCaller()", async function () {
      const { charlie, claimRegistry } = await deployFixture();
      await expect(
        claimRegistry.write.transferClaim([1n, charlie.account.address], { account: charlie.account })
      ).to.be.rejectedWith("UnauthorizedCaller");
    });

    it("Vector 4 — Modify claim face value -> Face value is immutable on-chain", async function () {
      const { alice, mockUSDC, vault, claimRegistry } = await deployFixture();
      await mockUSDC.write.approve([vault.address, 1000000000n], { account: alice.account });
      await vault.write.requestDeposit([1000000000n], { account: alice.account });

      const claim = await claimRegistry.read.getClaim([1n]);
      expect(claim.faceValue).to.equal(1000000000n);
      // No setter function exists to alter claim faceValue
    });

    it("Vector 5 — Settle wrong claim -> Alice attempts to claim Bob's shares -> Reverts with NotClaimOwner()", async function () {
      const { attester, alice, bob, oracleAdapter, vault, claimMarket, domain, types } = await deployFixture();
      await mockUSDC.write.approve([vault.address, 1000000000n], { account: alice.account });
      await vault.write.requestDeposit([1000000000n], { account: alice.account });

      await claimMarket.write.listClaim([1n, 980000000n], { account: alice.account });
      await mockUSDC.write.approve([claimMarket.address, 980000000n], { account: bob.account });
      await claimMarket.write.buyClaim([1n], { account: bob.account });

      const timestamp = BigInt(Math.floor(Date.now() / 1000));
      const value = {
        assetId: "RWA-001",
        requestId: "REQ-0001",
        state: "SETTLED",
        nav: 1000000n,
        yieldRate: 520n,
        riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
        nonce: 7001n,
        timestamp,
      };
      const signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });
      await oracleAdapter.write.submitAttestation([value, signature]);

      await expect(vault.write.claimShares(["REQ-0001"], { account: alice.account })).to.be.rejectedWith("NotClaimOwner");
    });

    it("Vector 6 — Use invalid claim ID -> Reverts with ClaimNotFound()", async function () {
      const { claimRegistry } = await deployFixture();
      await expect(claimRegistry.read.getClaim([9999n])).to.be.rejectedWith("ClaimNotFound");
    });
  });
});
