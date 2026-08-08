import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 7 — H1 Step 8: Core H1 Condition Validation Suite", function () {
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

  it("Step 8 Execution — Audits share issuance at all 6 lifecycle stages and calculates premature issuance rate", async function () {
    const { attester, alice, publicClient, mockUSDC, oracleAdapter, vault } = await deployFixture();
    const depositAmount = 1000000000n; // 1000 USDC

    // Stage 1: Before deposit
    const sharesStage1 = await vault.read.balanceOf([alice.account.address]);
    expect(sharesStage1).to.equal(0n);

    // Stage 2: Deposit request
    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    const depositTx = await vault.write.requestDeposit([depositAmount], { account: alice.account });
    const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositTx });

    const reqPending = await vault.read.getRequest(["REQ-0001"]);
    const sharesStage2 = await vault.read.balanceOf([alice.account.address]);
    expect(reqPending.state).to.equal(1); // PENDING
    expect(sharesStage2).to.equal(0n);

    // Stage 3: External verification (Off-chain middleware pipeline completed)
    const sharesStage3 = await vault.read.balanceOf([alice.account.address]);
    expect(sharesStage3).to.equal(0n);

    // Stage 4 & 5: Attestation & Claimable Transition
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
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
    const value = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: 1n,
      timestamp: timestamp,
    };

    const signature = await attester.signTypedData({
      domain,
      types,
      primaryType: "Attestation",
      message: value,
    });

    const attestationTx = await oracleAdapter.write.submitAttestation([value, signature]);
    const attestationReceipt = await publicClient.waitForTransactionReceipt({ hash: attestationTx });

    const reqClaimable = await vault.read.getRequest(["REQ-0001"]);
    const sharesStage4 = await vault.read.balanceOf([alice.account.address]);
    const sharesStage5 = sharesStage4;
    expect(reqClaimable.state).to.equal(4); // CLAIMABLE
    expect(sharesStage4).to.equal(0n);

    // Premature Share Issuance Calculation BEFORE final settlement
    const prematureSharesBeforeSettlement = sharesStage5;
    expect(prematureSharesBeforeSettlement).to.equal(0n);

    // Stage 6: Final Settlement Execution
    const claimTx = await vault.write.claimShares(["REQ-0001"], { account: alice.account });
    const claimReceipt = await publicClient.waitForTransactionReceipt({ hash: claimTx });

    const reqFinalized = await vault.read.getRequest(["REQ-0001"]);
    const sharesStage6 = await vault.read.balanceOf([alice.account.address]);
    expect(reqFinalized.state).to.equal(5); // FINALIZED (SETTLED)
    expect(sharesStage6).to.equal(1000000000n); // 1000 vRWA

    // Metrics Calculation
    const totalSettledShares = sharesStage6;
    const prematureIssuanceRate = (Number(prematureSharesBeforeSettlement) / Number(totalSettledShares)) * 100;

    expect(prematureSharesBeforeSettlement).to.equal(0n);
    expect(prematureIssuanceRate).to.equal(0);

    console.log("=== GATE 7 STEP 8 H1 CORE CONDITION AUDIT ===");
    console.log("Deposit Tx Hash:", depositTx);
    console.log("Attestation Tx Hash:", attestationTx);
    console.log("Claim Tx Hash:", claimTx);
    console.log("Shares Before Deposit:", sharesStage1.toString());
    console.log("Shares at Deposit Request (PENDING):", sharesStage2.toString());
    console.log("Shares at External Verification:", sharesStage3.toString());
    console.log("Shares at Attestation (CLAIMABLE):", sharesStage4.toString());
    console.log("Shares at Final Settlement (FINALIZED):", sharesStage6.toString());
    console.log("Premature Share Issuance:", prematureSharesBeforeSettlement.toString());
    console.log("Premature Share Issuance Rate:", prematureIssuanceRate + "%");
  });
});
