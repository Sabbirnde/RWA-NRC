import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 7 — H2 Step 6: CORE Experiment — Settlement Prevention Validation Suite", function () {
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

    // Create deposit requests
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: alice.account });
    await vault.write.requestDeposit([1000000000n], { account: alice.account }); // REQ-0001 (H2-002)

    await mockUSDC.write.approve([vault.address, 1000000000n], { account: bob.account });
    await vault.write.requestDeposit([1000000000n], { account: bob.account }); // REQ-0002 (H2-003)

    await mockUSDC.write.approve([vault.address, 1000000000n], { account: charlie.account });
    await vault.write.requestDeposit([1000000000n], { account: charlie.account }); // REQ-0003 (H2-004)

    return {
      alice,
      bob,
      charlie,
      vault,
    };
  }

  it("1. Request H2-003 (Stale Data) — Settlement attempt reverts and state remains PENDING", async function () {
    const { bob, vault } = await deployFixture();
    
    // Verify State BEFORE
    const reqBefore = await vault.read.getRequest(["REQ-0002"]);
    expect(reqBefore.state).to.equal(1); // PENDING
    expect(reqBefore.claimableShares).to.equal(0n);

    // Execute Settlement Attempt
    await expect(vault.write.claimShares(["REQ-0002"], { account: bob.account })).to.be.rejectedWith("RequestNotClaimable");

    // Verify State AFTER
    const reqAfter = await vault.read.getRequest(["REQ-0002"]);
    const bobShares = await vault.read.balanceOf([bob.account.address]);
    expect(reqAfter.state).to.equal(1); // PENDING / BLOCKED
    expect(reqAfter.claimableShares).to.equal(0n);
    expect(bobShares).to.equal(0n);
  });

  it("2. Request H2-002 (Invalid Data) — Settlement attempt reverts and state remains PENDING", async function () {
    const { alice, vault } = await deployFixture();

    // Verify State BEFORE
    const reqBefore = await vault.read.getRequest(["REQ-0001"]);
    expect(reqBefore.state).to.equal(1); // PENDING
    expect(reqBefore.claimableShares).to.equal(0n);

    // Execute Settlement Attempt
    await expect(vault.write.claimShares(["REQ-0001"], { account: alice.account })).to.be.rejectedWith("RequestNotClaimable");

    // Verify State AFTER
    const reqAfter = await vault.read.getRequest(["REQ-0001"]);
    const aliceShares = await vault.read.balanceOf([alice.account.address]);
    expect(reqAfter.state).to.equal(1); // PENDING / BLOCKED
    expect(reqAfter.claimableShares).to.equal(0n);
    expect(aliceShares).to.equal(0n);
  });

  it("3. Request H2-004 (High Risk State) — Settlement attempt reverts and state remains PENDING", async function () {
    const { charlie, vault } = await deployFixture();

    // Verify State BEFORE
    const reqBefore = await vault.read.getRequest(["REQ-0003"]);
    expect(reqBefore.state).to.equal(1); // PENDING
    expect(reqBefore.claimableShares).to.equal(0n);

    // Execute Settlement Attempt
    await expect(vault.write.claimShares(["REQ-0003"], { account: charlie.account })).to.be.rejectedWith("RequestNotClaimable");

    // Verify State AFTER
    const reqAfter = await vault.read.getRequest(["REQ-0003"]);
    const charlieShares = await vault.read.balanceOf([charlie.account.address]);
    expect(reqAfter.state).to.equal(1); // PENDING / BLOCKED
    expect(reqAfter.claimableShares).to.equal(0n);
    expect(charlieShares).to.equal(0n);
  });
});
