import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 7 — H3 Step 1: Asynchronous Pending-Claim State Validation Suite", function () {
  async function deployFixture() {
    const [deployer, attester, alice, bob] = await hre.viem.getWalletClients();
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

    return {
      alice,
      bob,
      publicClient,
      mockUSDC,
      vault,
      claimRegistry,
    };
  }

  it("Step 1 — Verifies that Alice's 1000 USDC deposit creates a pending claim with zero settlement", async function () {
    const { alice, publicClient, mockUSDC, vault, claimRegistry } = await deployFixture();
    const depositAmount = 1000000000n; // 1000 USDC

    // Execute Alice Deposit Request
    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    const depositTx = await vault.write.requestDeposit([depositAmount], { account: alice.account });
    const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositTx });
    const block = await publicClient.getBlock({ blockHash: depositReceipt.blockHash });

    // Inspect On-Chain State
    const req = await vault.read.getRequest(["REQ-0001"]);
    const claimId = await claimRegistry.read.requestIdToClaimId(["REQ-0001"]);
    const claim = await claimRegistry.read.getClaim([claimId]);
    const aliceShares = await vault.read.balanceOf([alice.account.address]);

    // Mandatory Invariant Assertions
    expect(depositReceipt.status).to.equal("success");
    expect(req.id).to.equal("REQ-0001");
    expect(req.state).to.equal(1); // PENDING (Enum index 1)
    expect(req.claimableShares).to.equal(0n);
    expect(claimId).to.equal(1n);
    expect(claim.owner.toLowerCase()).to.equal(alice.account.address.toLowerCase());
    expect(claim.faceValue).to.equal(depositAmount);
    expect(claim.status).to.equal(0); // Active (Enum index 0, NOT settled)
    expect(aliceShares).to.equal(0n); // Must FAIL if shares are minted immediately!

    console.log("=== GATE 7 H3 STEP 1 PENDING CLAIM EVIDENCE ===");
    console.log("Transaction Hash:", depositTx);
    console.log("Block Number:", depositReceipt.blockNumber.toString());
    console.log("Timestamp:", block.timestamp.toString());
    console.log("Request ID:", req.id);
    console.log("Claim ID:", claimId.toString());
    console.log("Owner:", claim.owner, "(Alice)");
    console.log("Claim Amount:", claim.faceValue.toString(), "(1,000 USDC)");
    console.log("Request State:", "PENDING (1)");
    console.log("Claim Status:", "Active (0, NOT SETTLED)");
    console.log("Alice vRWA Shares Issued:", aliceShares.toString(), "(0 vRWA)");
  });
});
