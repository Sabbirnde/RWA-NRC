import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 7 — H2 Step 8: Dynamic Safety Mechanism Recovery Validation Suite", function () {
  async function deployFixture() {
    const [deployer, attester, bob] = await hre.viem.getWalletClients();
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
    await mockUSDC.write.mint([bob.account.address, initialAmount]);

    // Create deposit request REQ-0002 (#H2-003)
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: bob.account });
    await vault.write.requestDeposit([1000000000n], { account: bob.account });

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
      bob,
      publicClient,
      oracleAdapter,
      vault,
      domain,
      types,
    };
  }

  it("Step 8 Dynamic Safety — Stale request REQ-0002 (#H2-003) recovers & settles successfully upon fresh data arrival", async function () {
    const { attester, bob, publicClient, oracleAdapter, vault, domain, types } = await deployFixture();

    // 1. PHASE 1: Stale Data Attempt (Age 37m) -> STALE STATE BLOCK
    const staleTimestamp = BigInt(Math.floor(Date.now() / 1000) - 2220);
    const staleValue = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: 401n,
      timestamp: staleTimestamp,
    };
    const staleSig = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: staleValue });
    await expect(oracleAdapter.write.submitAttestation([staleValue, staleSig])).to.be.rejectedWith("StaleAttestation");

    const reqPhase1 = await vault.read.getRequest(["REQ-0001"]);
    expect(reqPhase1.state).to.equal(1); // PENDING / BLOCKED

    // 2. PHASE 2: Fresh Valid Data Arrival -> FRESH VALID STATE ALLOW
    const freshTimestamp = BigInt(Math.floor(Date.now() / 1000));
    const freshValue = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: 402n,
      timestamp: freshTimestamp,
    };
    const freshSig = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: freshValue });

    // Submit Fresh Attestation
    const attestationTx = await oracleAdapter.write.submitAttestation([freshValue, freshSig]);
    const attestationReceipt = await publicClient.waitForTransactionReceipt({ hash: attestationTx });
    expect(attestationReceipt.status).to.equal("success");

    const reqPhase2 = await vault.read.getRequest(["REQ-0001"]);
    expect(reqPhase2.state).to.equal(4); // CLAIMABLE

    // Execute Settlement (claimShares)
    const settlementTx = await vault.write.claimShares(["REQ-0001"], { account: bob.account });
    const settlementReceipt = await publicClient.waitForTransactionReceipt({ hash: settlementTx });
    expect(settlementReceipt.status).to.equal("success");

    const reqPhase3 = await vault.read.getRequest(["REQ-0001"]);
    const bobShares = await vault.read.balanceOf([bob.account.address]);
    expect(reqPhase3.state).to.equal(5); // FINALIZED (SETTLED)
    expect(bobShares).to.equal(1000000000000000000000n); // 1,000 vRWA

    console.log("=== GATE 7 H2 STEP 8 DYNAMIC RECOVERY EVIDENCE ===");
    console.log("Request ID: REQ-H2-003 (On-Chain ID: REQ-0001)");
    console.log("Fresh Attestation Nonce:", freshValue.nonce.toString());
    console.log("Fresh Attestation Signature:", freshSig);
    console.log("Attestation Transaction Hash:", attestationTx);
    console.log("Settlement Transaction Hash:", settlementTx);
    console.log("Final Blockchain State: FINALIZED (5)");
    console.log("Bob vRWA Share Balance:", bobShares.toString(), "(1,000 vRWA)");
  });
});
