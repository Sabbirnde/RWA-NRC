import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 7 — H1 Step 4: Prove PENDING is a Real Protocol State", function () {
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

  it("Step 4 Execution — Validates 8 mandatory PENDING state invariants while holding settlement", async function () {
    const { alice, mockUSDC, oracleAdapter, vault } = await deployFixture();
    const depositAmount = 1000000000n; // 1000 USDC

    // Create deposit request REQ-0001
    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    await vault.write.requestDeposit([depositAmount], { account: alice.account });

    // Inspect request state on-chain
    const req = await vault.read.getRequest(["REQ-0001"]);
    const aliceShares = await vault.read.balanceOf([alice.account.address]);
    const vaultTotalShares = await vault.read.totalSupply();
    const vaultUsdcBalance = await mockUSDC.read.balanceOf([vault.address]);
    const nonceUsed = await oracleAdapter.read.usedNonces([1n]);

    // 1. Request exists
    expect(req.requestId).to.equal("REQ-0001");

    // 2. Request has correct amount
    expect(req.amount).to.equal(depositAmount);

    // 3. Request belongs to Alice
    expect(req.owner.toLowerCase()).to.equal(alice.account.address.toLowerCase());

    // 4. Request status is PENDING
    expect(req.state).to.equal(1); // Pending state (enum 1)

    // 5. Request has not been settled
    expect(req.state).to.not.equal(3); // Not Settled
    expect(req.state).to.not.equal(5); // Not Finalized

    // 6. Alice has not received final shares
    expect(aliceShares).to.equal(0n);

    // 7. Vault accounting does not treat request as fully settled
    expect(req.claimableShares).to.equal(0n);
    expect(vaultTotalShares).to.equal(0n);
    expect(vaultUsdcBalance).to.equal(depositAmount);

    // 8. No valid settlement attestation has been consumed
    expect(nonceUsed).to.be.false;

    console.log("=== GATE 7 STEP 4 CAPTURED STATE EVIDENCE ===");
    console.log("Request ID: REQ-0001");
    console.log("Status: PENDING");
    console.log("Deposit: 1000 USDC");
    console.log("Settled: NO");
    console.log("Claimable: NO");
    console.log("Shares issued: 0");
    console.log("Attestation: NOT YET VALID");
  });
});
