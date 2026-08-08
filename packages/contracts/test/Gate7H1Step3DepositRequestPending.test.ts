import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 7 — H1 Step 3: First Asynchronous Transition (Deposit Request -> PENDING)", function () {
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
      deployer,
      attester,
      alice,
      publicClient,
      mockUSDC,
      oracleAdapter,
      vault,
    };
  }

  it("Step 3 Execution — Captures on-chain evidence that PENDING state issues 0 premature shares", async function () {
    const { alice, publicClient, mockUSDC, vault } = await deployFixture();
    const depositAmount = 1000000000n; // 1000 USDC

    // 1. Share balance before deposit
    const sharesBefore = await vault.read.balanceOf([alice.account.address]);
    expect(sharesBefore).to.equal(0n);

    const aliceUsdcBefore = await mockUSDC.read.balanceOf([alice.account.address]);

    // 2. Execute Approve & Request Deposit
    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });

    const requestTx = await vault.write.requestDeposit([depositAmount], { account: alice.account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: requestTx });

    // 3. Share balance immediately after request
    const sharesAfter = await vault.read.balanceOf([alice.account.address]);
    const aliceUsdcAfter = await mockUSDC.read.balanceOf([alice.account.address]);
    const vaultTotalAssets = await mockUSDC.read.balanceOf([vault.address]);
    const vaultTotalShares = await vault.read.totalSupply();

    const request = await vault.read.getRequest(["REQ-0001"]);

    // Evidence & Assertions
    expect(receipt.status).to.equal("success");
    expect(request.state).to.equal(1); // Pending (enum 1)
    expect(sharesAfter).to.equal(0n); // sharesIssuedAtRequestCreation = 0
    expect(vaultTotalShares).to.equal(0n);
    expect(aliceUsdcBefore - aliceUsdcAfter).to.equal(depositAmount);
    expect(vaultTotalAssets).to.equal(depositAmount);

    console.log("=== GATE 7 STEP 3 ON-CHAIN EVIDENCE ===");
    console.log("Transaction Hash:", requestTx);
    console.log("Block Number:", receipt.blockNumber.toString());
    console.log("Request ID:", request.requestId);
    console.log("User Account:", alice.account.address);
    console.log("Deposit Amount:", depositAmount.toString(), "(1000 USDC)");
    console.log("Request Timestamp:", request.createdAt.toString());
    console.log("Request Status:", "PENDING (1)");
    console.log("Alice USDC Balance After:", aliceUsdcAfter.toString());
    console.log("Alice Vault Shares After:", sharesAfter.toString(), "(0 shares)");
    console.log("Vault Total Assets:", vaultTotalAssets.toString());
    console.log("Vault Total Shares:", vaultTotalShares.toString());
    console.log("Events Count:", receipt.logs.length);
  });
});
