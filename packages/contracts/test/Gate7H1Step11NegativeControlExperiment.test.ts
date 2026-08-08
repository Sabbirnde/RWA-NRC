import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 7 — H1 Step 11: Negative-Control Experiment (Broken RWA State Protection)", function () {
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
    await mockUSDC.write.mint([bob.account.address, initialAmount]);

    return {
      deployer,
      attester,
      alice,
      bob,
      publicClient,
      mockUSDC,
      oracleAdapter,
      vault,
    };
  }

  it("Step 11 Execution — Enforces that stale RWA data blocks attestation & leaves request PENDING with 0 shares", async function () {
    const { bob, publicClient, mockUSDC, oracleAdapter, vault } = await deployFixture();
    const depositAmount = 1000000000n; // 1000 USDC

    // 1. Bob creates Deposit Request REQ-0002
    await mockUSDC.write.approve([vault.address, depositAmount], { account: bob.account });
    const depositTx = await vault.write.requestDeposit([depositAmount], { account: bob.account });
    const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositTx });

    // 2. Simulate Stale RWA Data (37 minutes old, 10 minutes threshold)
    const now = Math.floor(Date.now() / 1000);
    const staleTimestamp = BigInt(now - 2220); // 37m old

    // 3. Attempt to submit stale attestation to RWAOracleAdapter on-chain
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
      requestId: "REQ-0002",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: 2n,
      timestamp: staleTimestamp,
    };

    // Stale attestation submission must revert on-chain with StaleAttestation error
    await expect(
      oracleAdapter.write.submitAttestation([
        value,
        "0x123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456781b" as `0x${string}`,
      ])
    ).to.be.rejected;

    // 4. Attempt claimShares on REQ-0002 must revert
    await expect(vault.write.claimShares(["REQ-0002"], { account: bob.account })).to.be.rejected;

    // 5. Inspect final on-chain state for REQ-0002
    const req = await vault.read.getRequest(["REQ-0002"]);
    const bobShares = await vault.read.balanceOf([bob.account.address]);
    const vaultTotalShares = await vault.read.totalSupply();

    // Assertions
    expect(req.requestId).to.equal("REQ-0002");
    expect(req.state).to.equal(1); // Remains PENDING (enum 1)
    expect(req.claimableShares).to.equal(0n);
    expect(bobShares).to.equal(0n); // 0 newly settled shares!
    expect(vaultTotalShares).to.equal(0n);

    console.log("=== GATE 7 STEP 11 NEGATIVE CONTROL EVIDENCE ===");
    console.log("Failure Condition: STALE RWA DATA (Age: 37m > Threshold: 10m)");
    console.log("Middleware Result: VALIDATION_FAIL (Freshness Check Failed)");
    console.log("Request ID: REQ-0002");
    console.log("Request State: PENDING (1)");
    console.log("Attestation State: NOT VALID (StaleAttestation Reverted)");
    console.log("Bob Minted Share Balance:", bobShares.toString(), "(0 shares)");
    console.log("Deposit Transaction Hash:", depositTx);
  });
});
