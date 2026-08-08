import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 7 — H3 Step 5: Core H3 Experiment — Claim #002 Liquidity Realization Before Settlement Suite", function () {
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

  it("Step 5 Core Experiment — Proves Alice receives 980 USDC for Claim #002 while underlying RWA remains PENDING", async function () {
    const { alice, bob, publicClient, mockUSDC, vault, claimRegistry, claimMarket } = await deployFixture();
    const depositAmount = 1000000000n; // 1000 USDC
    const salePrice = 980000000n;      // 980 USDC

    // 1. t_claim_created: Deposit 1000 USDC -> REQ-0001 & REQ-0002 (Claim #002)
    await mockUSDC.write.approve([vault.address, 2000000000n], { account: alice.account });
    await vault.write.requestDeposit([1000000000n], { account: alice.account }); // REQ-0001

    const depositTx2 = await vault.write.requestDeposit([1000000000n], { account: alice.account }); // REQ-0002 -> Claim #002
    const depositReceipt2 = await publicClient.waitForTransactionReceipt({ hash: depositTx2 });
    const depositBlock2 = await publicClient.getBlock({ blockHash: depositReceipt2.blockHash });
    const t_claim_created = depositBlock2.timestamp;

    const claimId2 = 2n;

    // 2. t_claim_listed: Alice lists Claim #002 for 980 USDC
    const listTx = await claimMarket.write.listClaim([claimId2, salePrice], { account: alice.account });
    const listReceipt = await publicClient.waitForTransactionReceipt({ hash: listTx });
    const listBlock = await publicClient.getBlock({ blockHash: listReceipt.blockHash });
    const t_claim_listed = listBlock.timestamp;

    // 3. t_claim_purchased / t_liquidity_received: Bob buys Claim #002
    await mockUSDC.write.approve([claimMarket.address, salePrice], { account: bob.account });
    const buyTx = await claimMarket.write.buyClaim([claimId2], { account: bob.account });
    const buyReceipt = await publicClient.waitForTransactionReceipt({ hash: buyTx });
    const buyBlock = await publicClient.getBlock({ blockHash: buyReceipt.blockHash });
    const t_claim_purchased = buyBlock.timestamp;
    const t_liquidity_received = t_claim_purchased;

    // t_underlying_settlement: NOT COMPLETE (N/A - DOES NOT EXIST YET!)
    const t_underlying_settlement = "N/A";

    // Calculate Liquidity Delay
    const liquidityDelaySeconds = t_liquidity_received - t_claim_created;

    // Inspect Balances & Invariants
    const req2 = await vault.read.getRequest(["REQ-0002"]);
    const aliceUsdc = await mockUSDC.read.balanceOf([alice.account.address]);
    const aliceShares = await vault.read.balanceOf([alice.account.address]);
    const bobShares = await vault.read.balanceOf([bob.account.address]);
    const claim2 = await claimRegistry.read.getClaim([claimId2]);

    // Mandatory Invariant Assertions
    expect(req2.state).to.equal(1); // PENDING
    expect(req2.claimableShares).to.equal(0n);
    expect(aliceShares).to.equal(0n);
    expect(bobShares).to.equal(0n);
    expect(aliceUsdc).to.equal(98980000000n); // 98,980 USDC net balance (Initial - 2,000 deposit + 980 cash)
    expect(claim2.owner.toLowerCase()).to.equal(bob.account.address.toLowerCase());

    console.log("=== GATE 7 H3 STEP 5 CLAIM #002 TIMING EVIDENCE ===");
    console.log("Deposit Request ID: REQ-0002");
    console.log("Claim ID: Claim #002");
    console.log("t_claim_created:", t_claim_created.toString(), "(Block #" + depositReceipt2.blockNumber + ")");
    console.log("t_claim_listed:", t_claim_listed.toString(), "(Block #" + listReceipt.blockNumber + ")");
    console.log("t_claim_purchased:", t_claim_purchased.toString(), "(Block #" + buyReceipt.blockNumber + ")");
    console.log("t_liquidity_received:", t_liquidity_received.toString());
    console.log("t_underlying_settlement:", t_underlying_settlement, "(Does NOT exist yet!)");
    console.log("Liquidity Delay (t_liquidity_received - t_claim_created):", liquidityDelaySeconds.toString() + " seconds");
    console.log("Alice Cash Received:", "980 USDC");
    console.log("Underlying Claim Request State:", "PENDING (1)");
    console.log("Underlying Settlement Status:", "NOT COMPLETE (0 claimable shares)");
  });
});
