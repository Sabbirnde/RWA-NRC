import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 7 — Research Hypothesis H1 Validation Suite", function () {
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

  it("H1 VALIDATION EXPERIMENT: Proves asynchronous deposit & deferred share issuance hypothesis", async function () {
    const { attester, alice, mockUSDC, oracleAdapter, vault } = await deployFixture();
    const depositAmount = 1000000000n; // 1000 USDC (6 decimals)

    // --- STEP 1: Alice Submits Deposit Request ---
    const aliceUsdcBefore = await mockUSDC.read.balanceOf([alice.account.address]);
    const vaultUsdcBefore = await mockUSDC.read.balanceOf([vault.address]);

    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    await vault.write.requestDeposit([depositAmount], { account: alice.account });

    // --- STEP 2: Verify PENDING State & Zero Premature Shares ---
    const aliceUsdcAfter = await mockUSDC.read.balanceOf([alice.account.address]);
    const vaultUsdcAfter = await mockUSDC.read.balanceOf([vault.address]);
    const aliceSharesPending = await vault.read.balanceOf([alice.account.address]);

    expect(aliceUsdcBefore - aliceUsdcAfter).to.equal(depositAmount);
    expect(vaultUsdcAfter - vaultUsdcBefore).to.equal(depositAmount);
    expect(aliceSharesPending).to.equal(0n); // ZERO premature shares issued!

    const reqPending = await vault.read.getRequest(["REQ-0001"]);
    expect(reqPending.state).to.equal(1); // Pending state (enum 1)
    expect(reqPending.claimableShares).to.equal(0n);

    // --- STEP 3: Verify Premature Claim Attempt Reverts ---
    await expect(vault.write.claimShares(["REQ-0001"], { account: alice.account })).to.be.rejected;

    // --- STEP 4: Submit Valid Attestation & Transition to CLAIMABLE ---
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

    await oracleAdapter.write.submitAttestation([value, signature]);

    const reqClaimable = await vault.read.getRequest(["REQ-0001"]);
    expect(reqClaimable.state).to.equal(4); // Claimable state (enum 4)
    expect(reqClaimable.claimableShares).to.equal(1000000000n);

    // --- STEP 5: Execute Claim & Verify Final Share Issuance ---
    await vault.write.claimShares(["REQ-0001"], { account: alice.account });

    const aliceSharesFinal = await vault.read.balanceOf([alice.account.address]);
    const reqFinalized = await vault.read.getRequest(["REQ-0001"]);

    expect(aliceSharesFinal).to.equal(1000000000n); // Shares minted ONLY upon settlement!
    expect(reqFinalized.state).to.equal(5); // Finalized state (enum 5)
    expect(reqFinalized.claimableShares).to.equal(0n);
  });
});
