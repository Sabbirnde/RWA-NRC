import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 7 — H3 Step 2: Baseline Liquidity Gap Verification Suite", function () {
  async function deployFixture() {
    const [deployer, attester, alice] = await hre.viem.getWalletClients();
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

    return {
      alice,
      publicClient,
      mockUSDC,
      vault,
      claimRegistry,
    };
  }

  it("Step 2 Baseline Gap — Verifies Alice owns pending claim but cannot access underlying settlement liquidity", async function () {
    const { alice, publicClient, mockUSDC, vault, claimRegistry } = await deployFixture();
    const depositAmount = 1000000000n; // 1000 USDC

    const initialBalance = await mockUSDC.read.balanceOf([alice.account.address]);

    // Deposit 1,000 USDC -> Request REQ-0001 & Claim #1 Created
    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    const depositTx = await vault.write.requestDeposit([depositAmount], { account: alice.account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: depositTx });
    const block = await publicClient.getBlock({ blockHash: receipt.blockHash });
    const t_claim_created = block.timestamp;

    // Inspect Alice Balances & Claim Attributes
    const aliceUsdcAfterDeposit = await mockUSDC.read.balanceOf([alice.account.address]);
    const aliceShares = await vault.read.balanceOf([alice.account.address]);
    const req = await vault.read.getRequest(["REQ-0001"]);
    const claimId = await claimRegistry.read.requestIdToClaimId(["REQ-0001"]);
    const claim = await claimRegistry.read.getClaim([claimId]);

    // Assertions Proving Baseline Liquidity Gap
    expect(aliceUsdcAfterDeposit).to.equal(initialBalance - depositAmount); // -1000 USDC
    expect(aliceShares).to.equal(0n); // 0 vRWA shares
    expect(claim.owner.toLowerCase()).to.equal(alice.account.address.toLowerCase());
    expect(claim.faceValue).to.equal(depositAmount);
    expect(claim.status).to.equal(0); // Active (Pending settlement)
    expect(req.state).to.equal(1); // PENDING
    expect(req.claimableShares).to.equal(0n);

    // Attempting direct redemption / claim fails
    await expect(vault.write.claimShares(["REQ-0001"], { account: alice.account })).to.be.rejectedWith("RequestNotClaimable");

    console.log("=== GATE 7 H3 STEP 2 BASELINE LIQUIDITY GAP EVIDENCE ===");
    console.log("t_claim_created:", t_claim_created.toString(), "(Epoch seconds)");
    console.log("Alice USDC Balance:", aliceUsdcAfterDeposit.toString(), "(Initial - $1,000 USDC)");
    console.log("Alice vRWA Share Balance:", aliceShares.toString(), "(0 vRWA)");
    console.log("Claim Face Value:", claim.faceValue.toString(), "(1,000 USDC)");
    console.log("Claim Status:", "Active (0, Pending)");
    console.log("Settlement Status:", "PENDING (1, 0 claimable shares)");
    console.log("Redemption Availability:", "UNAVAILABLE (RequestNotClaimable)");
    console.log("BASELINE LIQUIDITY GAP = VERIFIED");
  });
});
