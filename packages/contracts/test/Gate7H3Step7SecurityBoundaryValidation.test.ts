import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 7 — H3 Step 7: Claim Market & Settlement Security Validation Suite", function () {
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

    // Create deposit request REQ-0001 (Claim #1) & REQ-0002 (Claim #2)
    await mockUSDC.write.approve([vault.address, 2000000000n], { account: alice.account });
    await vault.write.requestDeposit([1000000000n], { account: alice.account }); // REQ-0001
    await vault.write.requestDeposit([1000000000n], { account: alice.account }); // REQ-0002 -> Claim #2

    const domain = {
      name: "RWA-OracleAdapter",
      version: "1.0.0",
      chainId: 31337,
      verifyingContract: oracleAdapter.address,
    };
    const types = {
      Attestation: [
        { name: "assetId", type: "string" },
        { name: "requestId", type: "string" },
        { name: "state", type: "string" },
        { name: "nav", type: "uint256" },
        { name: "yieldRate", type: "uint256" },
        { name: "riskStatus", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "timestamp", type: "uint256" },
      ],
    };

    return {
      attester,
      alice,
      bob,
      charlie,
      publicClient,
      mockUSDC,
      oracleAdapter,
      vault,
      claimRegistry,
      claimMarket,
      domain,
      types,
    };
  }

  it("Test 1 — Alice attempts to redeem Claim #002 after selling to Bob -> Reverts with NotClaimOwner()", async function () {
    const { attester, alice, bob, oracleAdapter, vault, claimMarket, domain, types } = await deployFixture();
    const claimId2 = 2n;
    const salePrice = 980000000n;

    // Alice lists & Bob buys Claim #002
    await claimMarket.write.listClaim([claimId2, salePrice], { account: alice.account });
    await mockUSDC.write.approve([claimMarket.address, salePrice], { account: bob.account });
    await claimMarket.write.buyClaim([claimId2], { account: bob.account });

    // Submit Attestation for REQ-0002
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const value = {
      assetId: "RWA-001",
      requestId: "REQ-0002",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: 701n,
      timestamp,
    };
    const signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });
    await oracleAdapter.write.submitAttestation([value, signature]);

    // Alice attempts to claim shares for REQ-0002 (sold to Bob)
    await expect(vault.write.claimShares(["REQ-0002"], { account: alice.account })).to.be.rejectedWith("NotClaimOwner");
  });

  it("Test 2 — Bob (rightful owner) redeems Claim #002 -> SUCCESS", async function () {
    const { attester, alice, bob, oracleAdapter, vault, claimMarket, domain, types } = await deployFixture();
    const claimId2 = 2n;
    const salePrice = 980000000n;

    await claimMarket.write.listClaim([claimId2, salePrice], { account: alice.account });
    await mockUSDC.write.approve([claimMarket.address, salePrice], { account: bob.account });
    await claimMarket.write.buyClaim([claimId2], { account: bob.account });

    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const value = {
      assetId: "RWA-001",
      requestId: "REQ-0002",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: 702n,
      timestamp,
    };
    const signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });
    await oracleAdapter.write.submitAttestation([value, signature]);

    // Bob claims shares for REQ-0002
    await vault.write.claimShares(["REQ-0002"], { account: bob.account });
    const bobShares = await vault.read.balanceOf([bob.account.address]);
    expect(bobShares).to.equal(1000000000000000000000n); // 1,000 vRWA shares
  });

  it("Test 3 — Bob attempts to redeem Claim #002 again -> Reverts with RequestAlreadyClaimed()", async function () {
    const { attester, alice, bob, oracleAdapter, vault, claimMarket, domain, types } = await deployFixture();
    const claimId2 = 2n;
    const salePrice = 980000000n;

    await claimMarket.write.listClaim([claimId2, salePrice], { account: alice.account });
    await mockUSDC.write.approve([claimMarket.address, salePrice], { account: bob.account });
    await claimMarket.write.buyClaim([claimId2], { account: bob.account });

    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const value = {
      assetId: "RWA-001",
      requestId: "REQ-0002",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: 703n,
      timestamp,
    };
    const signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });
    await oracleAdapter.write.submitAttestation([value, signature]);

    await vault.write.claimShares(["REQ-0002"], { account: bob.account });
    // Second claim attempt by Bob
    await expect(vault.write.claimShares(["REQ-0002"], { account: bob.account })).to.be.rejectedWith("RequestAlreadyClaimed");
  });

  it("Test 4 — Alice attempts to sell Claim #002 again after selling -> Reverts with NotClaimOwner()", async function () {
    const { alice, bob, mockUSDC, claimMarket } = await deployFixture();
    const claimId2 = 2n;
    const salePrice = 980000000n;

    await claimMarket.write.listClaim([claimId2, salePrice], { account: alice.account });
    await mockUSDC.write.approve([claimMarket.address, salePrice], { account: bob.account });
    await claimMarket.write.buyClaim([claimId2], { account: bob.account });

    // Alice attempts to list Claim #002 again
    await expect(claimMarket.write.listClaim([claimId2, salePrice], { account: alice.account })).to.be.rejectedWith("NotClaimOwner");
  });

  it("Test 5 — Attempt to create two active listings for the same claim -> Second listing overwrites or fails safely", async function () {
    const { alice, claimMarket } = await deployFixture();
    const claimId2 = 2n;

    await claimMarket.write.listClaim([claimId2, 980000000n], { account: alice.account });
    // Relisting by same owner updates price cleanly
    await claimMarket.write.listClaim([claimId2, 970000000n], { account: alice.account });
    const listing = await claimMarket.read.getListing([claimId2]);
    expect(listing.price).to.equal(970000000n);
  });

  it("Test 6 — Attempt to transfer/sell same claim to two buyers -> Only one ownership transfer succeeds", async function () {
    const { alice, bob, charlie, mockUSDC, claimMarket } = await deployFixture();
    const claimId2 = 2n;
    const salePrice = 980000000n;

    await claimMarket.write.listClaim([claimId2, salePrice], { account: alice.account });

    // Bob buys first
    await mockUSDC.write.approve([claimMarket.address, salePrice], { account: bob.account });
    await claimMarket.write.buyClaim([claimId2], { account: bob.account });

    // Charlie attempts to buy inactive/sold listing
    await mockUSDC.write.approve([claimMarket.address, salePrice], { account: charlie.account });
    await expect(claimMarket.write.buyClaim([claimId2], { account: charlie.account })).to.be.rejectedWith("ListingNotActive");
  });
});
