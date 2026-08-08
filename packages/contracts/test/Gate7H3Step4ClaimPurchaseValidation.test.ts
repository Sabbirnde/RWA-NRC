import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 7 — H3 Step 4: Pending Claim Purchase & Ownership Transfer Validation Suite", function () {
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

    // Create deposit request REQ-0001 (Claim #1) & REQ-0002 (Claim #2)
    await mockUSDC.write.approve([vault.address, 2000000000n], { account: alice.account });
    await vault.write.requestDeposit([1000000000n], { account: alice.account }); // REQ-0001
    await vault.write.requestDeposit([1000000000n], { account: alice.account }); // REQ-0002 -> Claim #2

    // Alice lists Claim #2 for 980 USDC
    await claimMarket.write.listClaim([2n, 980000000n], { account: alice.account });

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

  it("Step 4 — Verifies Bob purchases Claim #2 for 980 USDC, transferring immediate liquidity to Alice while RWA remains PENDING", async function () {
    const { alice, bob, publicClient, mockUSDC, vault, claimRegistry, claimMarket } = await deployFixture();
    const claimId = 2n;
    const salePrice = 980000000n; // 980 USDC

    // Capture Balances BEFORE Purchase
    const aliceUsdcBefore = await mockUSDC.read.balanceOf([alice.account.address]);
    const bobUsdcBefore = await mockUSDC.read.balanceOf([bob.account.address]);
    const claimBefore = await claimRegistry.read.getClaim([claimId]);

    expect(claimBefore.owner.toLowerCase()).to.equal(alice.account.address.toLowerCase());

    // Execute Bob Purchase
    await mockUSDC.write.approve([claimMarket.address, salePrice], { account: bob.account });
    const buyTx = await claimMarket.write.buyClaim([claimId], { account: bob.account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: buyTx });
    const block = await publicClient.getBlock({ blockHash: receipt.blockHash });

    // Capture Balances & State AFTER Purchase
    const aliceUsdcAfter = await mockUSDC.read.balanceOf([alice.account.address]);
    const bobUsdcAfter = await mockUSDC.read.balanceOf([bob.account.address]);
    const claimAfter = await claimRegistry.read.getClaim([claimId]);
    const req = await vault.read.getRequest(["REQ-0002"]);
    const aliceShares = await vault.read.balanceOf([alice.account.address]);
    const bobShares = await vault.read.balanceOf([bob.account.address]);

    // Invariant Assertions
    expect(receipt.status).to.equal("success");
    expect(aliceUsdcAfter).to.equal(aliceUsdcBefore + salePrice); // +980 USDC
    expect(bobUsdcAfter).to.equal(bobUsdcBefore - salePrice);     // -980 USDC
    expect(claimAfter.owner.toLowerCase()).to.equal(bob.account.address.toLowerCase()); // Alice -> Bob
    expect(claimAfter.status).to.equal(2); // Transferred (Enum index 2)

    // CRITICAL REQUIREMENT: Underlying RWA state MUST remain PENDING
    expect(req.state).to.equal(1); // PENDING (Enum index 1)
    expect(req.claimableShares).to.equal(0n);
    expect(aliceShares).to.equal(0n);
    expect(bobShares).to.equal(0n);

    console.log("=== GATE 7 H3 STEP 4 CLAIM PURCHASE EVIDENCE ===");
    console.log("Purchase Transaction Hash:", buyTx);
    console.log("Block Number:", receipt.blockNumber.toString());
    console.log("t_purchased Timestamp:", block.timestamp.toString(), "(Epoch seconds)");
    console.log("Claim ID:", claimId.toString());
    console.log("Previous Owner:", claimBefore.owner, "(Alice)");
    console.log("New Owner:", claimAfter.owner, "(Bob)");
    console.log("Alice USDC Before / After:", aliceUsdcBefore.toString(), "->", aliceUsdcAfter.toString(), "(+980 USDC)");
    console.log("Bob USDC Before / After:", bobUsdcBefore.toString(), "->", bobUsdcAfter.toString(), "(-980 USDC)");
    console.log("Claim Status:", "Transferred (2)");
    console.log("Underlying Vault Request State:", "PENDING (1)");
    console.log("Underlying RWA Settlement Completed:", "NO (0 claimable shares, 0 vRWA minted)");
  });
});
