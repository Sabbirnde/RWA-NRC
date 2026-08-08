import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";
import { keccak256, stringToBytes } from "viem";

describe("GATE 5.7 — Finalized Claim Security & Non-Transferability Audit Suite", function () {
  async function deployFixture() {
    const [deployer, attester, alice, bob, buyer2] = await hre.viem.getWalletClients();
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
    await mockUSDC.write.mint([buyer2.account.address, initialAmount]);

    return {
      deployer,
      attester,
      alice,
      bob,
      buyer2,
      publicClient,
      mockUSDC,
      oracleAdapter,
      vault,
      claimRegistry,
      claimMarket,
    };
  }

  it("Enforces 7 post-finalization security invariants on Claim #002", async function () {
    const { attester, alice, bob, buyer2, publicClient, mockUSDC, oracleAdapter, vault, claimRegistry, claimMarket } =
      await deployFixture();

    const depositAmount = 1000000000n; // 1000 USDC
    const salePrice = 980000000n; // 980 USDC

    // 1. Setup Golden Flow: Alice deposit -> List -> Bob buy -> Settlement -> Bob claimShares
    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    await vault.write.requestDeposit([depositAmount], { account: alice.account });

    const reqInfo = await vault.read.getRequest(["REQ-0001"]);
    const claimId = reqInfo.claimId;

    await claimMarket.write.listClaim([claimId, salePrice], { account: alice.account });
    await mockUSDC.write.approve([claimMarket.address, salePrice], { account: bob.account });
    await claimMarket.write.buyClaim([claimId], { account: bob.account });

    // Submit Attestation
    const chainId = BigInt(hre.network.config.chainId || 31337);
    const nonce = 7001n;
    const currentBlock = await publicClient.getBlock();
    const timestamp = currentBlock.timestamp;
    const nav = 1002500n;

    const domain = {
      name: "RWA-OracleAdapter",
      version: "1.0.0",
      chainId: chainId,
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

    const params = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: nav,
      yieldRate: 520n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: nonce,
      timestamp: timestamp,
    };

    const signature = await attester.signTypedData({
      domain,
      types,
      primaryType: "Attestation",
      message: params,
    });

    await oracleAdapter.write.submitAttestation([params, signature], { account: attester.account });
    await vault.write.claimShares(["REQ-0001"], { account: bob.account });

    // Verify state is SETTLED
    const settledClaim = await claimRegistry.read.getClaim([claimId]);
    expect(settledClaim.status).to.equal(3); // 3 = Settled

    // Action 1: Bob LIST Claim #002 -> Reverts
    await expect(
      claimMarket.write.listClaim([claimId, salePrice], { account: bob.account })
    ).to.be.rejected;

    // Action 2: Bob SELL Claim #002 directly -> Reverts
    await expect(
      claimMarket.write.listClaim([claimId, 900000000n], { account: bob.account })
    ).to.be.rejected;

    // Action 3: Alice SELL Claim #002 -> Reverts with NotClaimOwner
    await expect(
      claimMarket.write.listClaim([claimId, salePrice], { account: alice.account })
    ).to.be.rejected;

    // Action 4: Bob transfer Claim #002 to buyer2 -> Reverts with ClaimNotTransferable
    await expect(
      claimRegistry.write.transferClaim([claimId, buyer2.account.address], { account: bob.account })
    ).to.be.rejected;

    // Action 5: Create a new marketplace order for Claim #002 -> Reverts
    await expect(
      claimMarket.write.listClaim([claimId, 950000000n], { account: bob.account })
    ).to.be.rejected;

    // Action 6: Execute an old marketplace order against Claim #002 -> Reverts with ListingNotActive
    await expect(
      claimMarket.write.buyClaim([claimId], { account: buyer2.account })
    ).to.be.rejected;

    // Action 7: Attempt another final settlement for Claim #002 -> Reverts with RequestNotClaimable
    await expect(
      vault.write.claimShares(["REQ-0001"], { account: bob.account })
    ).to.be.rejected;
  });
});
