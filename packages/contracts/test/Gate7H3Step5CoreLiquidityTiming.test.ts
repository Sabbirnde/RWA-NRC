import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 7 — H3 Step 5: Core H3 Experiment — Liquidity Realization Before Settlement Suite", function () {
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
      claimMarket,
    };
  }

  it("Step 5 Core Experiment — Proves Alice receives 980 USDC liquidity before underlying RWA settles", async function () {
    const { alice, bob, publicClient, mockUSDC, vault, claimRegistry, claimMarket } = await deployFixture();
    const depositAmount = 1000000000n; // 1000 USDC
    const salePrice = 980000000n;      // 980 USDC

    // 1. t_claim_created: Deposit 1000 USDC -> REQ-0001 & Claim #1
    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    const depositTx = await vault.write.requestDeposit([depositAmount], { account: alice.account });
    const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositTx });
    const depositBlock = await publicClient.getBlock({ blockHash: depositReceipt.blockHash });
    const t_claim_created = depositBlock.timestamp;

    // 2. t_claim_listed: Alice lists Claim #1 for 980 USDC
    const listTx = await claimMarket.write.listClaim([1n, salePrice], { account: alice.account });
    const listReceipt = await publicClient.waitForTransactionReceipt({ hash: listTx });
    const listBlock = await publicClient.getBlock({ blockHash: listReceipt.blockHash });
    const t_claim_listed = listBlock.timestamp;

    // 3. t_claim_purchased / t_liquidity_received: Bob buys Claim #1
    await mockUSDC.write.approve([claimMarket.address, salePrice], { account: bob.account });
    const buyTx = await claimMarket.write.buyClaim([1n], { account: bob.account });
    const buyReceipt = await publicClient.waitForTransactionReceipt({ hash: buyTx });
    const buyBlock = await publicClient.getBlock({ blockHash: buyReceipt.blockHash });
    const t_claim_purchased = buyBlock.timestamp;
    const t_liquidity_received = t_claim_purchased;

    // t_underlying_settlement: NOT COMPLETE (N/A)
    const t_underlying_settlement = "N/A";

    // Calculate Liquidity Delay
    const liquidityDelaySeconds = t_liquidity_received - t_claim_created;

    // Inspect Balances & Invariants
    const req = await vault.read.getRequest(["REQ-0001"]);
    const aliceUsdc = await mockUSDC.read.balanceOf([alice.account.address]);
    const aliceShares = await vault.read.balanceOf([alice.account.address]);
    const bobShares = await vault.read.balanceOf([bob.account.address]);

    // Mandatory Invariant Assertions
    expect(req.state).to.equal(1); // PENDING
    expect(req.claimableShares).to.equal(0n);
    expect(aliceShares).to.equal(0n);
    expect(bobShares).to.equal(0n);
    expect(aliceUsdc).to.equal(99980000000n); // Net +980 USDC cash

    console.log("=== GATE 7 H3 STEP 5 CORE LIQUIDITY TIMING EVIDENCE ===");
    console.log("t_claim_created:", t_claim_created.toString(), "(Block #" + depositReceipt.blockNumber + ")");
    console.log("t_claim_listed:", t_claim_listed.toString(), "(Block #" + listReceipt.blockNumber + ")");
    console.log("t_claim_purchased:", t_claim_purchased.toString(), "(Block #" + buyReceipt.blockNumber + ")");
    console.log("t_liquidity_received:", t_liquidity_received.toString());
    console.log("t_underlying_settlement:", t_underlying_settlement);
    console.log("Liquidity Delay (t_liquidity_received - t_claim_created):", liquidityDelaySeconds.toString() + " seconds");
    console.log("Alice Cash Received:", "980 USDC (Net Balance: 99,980 USDC)");
    console.log("Underlying Claim Request State:", "PENDING (1)");
    console.log("Underlying Settlement Status:", "NOT COMPLETE (0 claimable shares)");
  });
});
