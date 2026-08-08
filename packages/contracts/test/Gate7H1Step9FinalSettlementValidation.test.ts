import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 7 — H1 Step 9: Final Settlement Validation Suite", function () {
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

  it("Step 9 Execution — Captures pre/post settlement metrics, calculates share & accounting differences, and verifies final settlement", async function () {
    const { attester, alice, publicClient, mockUSDC, oracleAdapter, vault } = await deployFixture();
    const depositAmount = 1000000000n; // 1000 USDC

    // 1. Create deposit request REQ-0001 & submit attestation to reach CLAIMABLE
    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    await vault.write.requestDeposit([depositAmount], { account: alice.account });

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
    const signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });
    await oracleAdapter.write.submitAttestation([value, signature]);

    // 2. CAPTURE BEFORE SETTLEMENT
    const reqBefore = await vault.read.getRequest(["REQ-0001"]);
    const aliceSharesBefore = await vault.read.balanceOf([alice.account.address]);
    const vaultAssetsBefore = await mockUSDC.read.balanceOf([vault.address]);
    const vaultSharesBefore = await vault.read.totalSupply();

    expect(reqBefore.state).to.equal(4); // CLAIMABLE
    expect(aliceSharesBefore).to.equal(0n);
    expect(reqBefore.claimableShares).to.equal(1000000000000000000000n); // 1,000 * 10^18 wei

    // 3. EXECUTE SETTLEMENT
    const claimTx = await vault.write.claimShares(["REQ-0001"], { account: alice.account });
    const claimReceipt = await publicClient.waitForTransactionReceipt({ hash: claimTx });

    // 4. CAPTURE AFTER SETTLEMENT
    const reqAfter = await vault.read.getRequest(["REQ-0001"]);
    const aliceSharesAfter = await vault.read.balanceOf([alice.account.address]);
    const vaultAssetsAfter = await mockUSDC.read.balanceOf([vault.address]);
    const vaultSharesAfter = await vault.read.totalSupply();

    // 5. CALCULATE DIFFERENCES
    const shareDiff = aliceSharesAfter - aliceSharesBefore;
    const assetDiff = vaultAssetsAfter - vaultAssetsBefore;
    const claimableSharesDiff = reqAfter.claimableShares - reqBefore.claimableShares;

    expect(claimReceipt.status).to.equal("success");
    expect(reqAfter.state).to.equal(5); // FINALIZED (SETTLED)
    expect(aliceSharesAfter).to.equal(1000000000000000000000n); // 1,000 vRWA (18 decimals)
    expect(shareDiff).to.equal(1000000000000000000000n);
    expect(assetDiff).to.equal(0n); // Vault collateral unchanged
    expect(reqAfter.claimableShares).to.equal(0n);

    console.log("=== GATE 7 STEP 9 FINAL SETTLEMENT EVIDENCE ===");
    console.log("Before Settlement Request State:", "CLAIMABLE (4)");
    console.log("Before Settlement Alice Shares:", aliceSharesBefore.toString());
    console.log("Before Settlement Claimable Shares:", reqBefore.claimableShares.toString());
    console.log("Before Settlement Vault Assets:", vaultAssetsBefore.toString());
    console.log("Before Settlement Vault Total Shares:", vaultSharesBefore.toString());
    console.log("-----------------------------------------------");
    console.log("After Settlement Request State:", "FINALIZED (5)");
    console.log("After Settlement Alice Shares:", aliceSharesAfter.toString());
    console.log("After Settlement Claimable Shares:", reqAfter.claimableShares.toString());
    console.log("After Settlement Vault Assets:", vaultAssetsAfter.toString());
    console.log("After Settlement Vault Total Shares:", vaultSharesAfter.toString());
    console.log("-----------------------------------------------");
    console.log("Share Difference:", shareDiff.toString(), "(+1,000 vRWA)");
    console.log("Accounting Asset Difference:", assetDiff.toString());
    console.log("Settlement Transaction Hash:", claimTx);
  });
});
