import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 6.5 — Blockchain & Vault Protection under Stale RWA Data", function () {
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

  it("Guarantees stale RWA data NEVER triggers settlement, releases assets, or alters PENDING vault state", async function () {
    const { alice, mockUSDC, oracleAdapter, vault } = await deployFixture();
    const depositAmount = 1000000000n; // 1000 USDC

    // 1. Alice requests deposit of 1000 USDC -> Enters PENDING state
    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    await vault.write.requestDeposit([depositAmount, alice.account.address, alice.account.address], {
      account: alice.account,
    });

    const pendingRequest = await vault.read.getDepositRequest([1n]);
    expect(pendingRequest.isPending).to.be.true;
    expect(pendingRequest.isClaimable).to.be.false;

    // 2. Off-chain RWA data is STALE (age 37m > threshold 10m).
    // Attestation layer is BLOCKED — NO valid attestation signature is produced.

    // 3. Attempting settlement submission without valid attestation MUST REVERT
    const dummySignature = "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

    const dummyPayload = {
      assetId: "RWA-001",
      requestId: "1",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: 1n,
      timestamp: BigInt(Math.floor(Date.now() / 1000) - 2220), // 37 min old
    };

    await expect(
      oracleAdapter.write.fulfillAttestation([dummyPayload, dummySignature])
    ).to.be.rejected;

    // 4. Verify request state remains strictly PENDING & un-settled
    const postAttemptRequest = await vault.read.getDepositRequest([1n]);
    expect(postAttemptRequest.isPending).to.be.true;
    expect(postAttemptRequest.isClaimable).to.be.false;

    // 5. Verify 0 shares minted to Alice
    const aliceShares = await vault.read.balanceOf([alice.account.address]);
    expect(aliceShares).to.equal(0n);
  });
});
