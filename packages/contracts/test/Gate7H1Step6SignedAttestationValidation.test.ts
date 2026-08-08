import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 7 — H1 Step 6: Signed RWA Attestation & On-Chain Verification Suite", function () {
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

  it("Step 6 Execution — Generates EIP-712 attestation, verifies signature on-chain, transitions request to CLAIMABLE with 0 shares minted", async function () {
    const { attester, alice, publicClient, mockUSDC, oracleAdapter, vault } = await deployFixture();
    const depositAmount = 1000000000n; // 1000 USDC

    // 1. Create deposit request REQ-0001
    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    await vault.write.requestDeposit([depositAmount], { account: alice.account });

    // 2. Generate EIP-712 signed attestation for RWA-001 & REQ-0001
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
      nav: 1002500n,
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

    // 3. Submit attestation to RWAOracleAdapter on-chain
    const attestationTx = await oracleAdapter.write.submitAttestation([value, signature]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: attestationTx });

    // 4. Verify request state & share balances post-attestation
    const req = await vault.read.getRequest(["REQ-0001"]);
    const aliceShares = await vault.read.balanceOf([alice.account.address]);
    const vaultTotalShares = await vault.read.totalSupply();

    // Assertions
    expect(receipt.status).to.equal("success");
    expect(signature).to.be.a("string").that.is.not.empty;
    expect(req.state).to.equal(4); // Claimable (enum 4)
    expect(req.claimableShares).to.equal(1000000000n);
    expect(aliceShares).to.equal(0n); // ZERO shares minted to Alice by attestation!
    expect(vaultTotalShares).to.equal(0n); // Total supply remains 0!

    console.log("=== GATE 7 STEP 6 ATTESTATION EVIDENCE ===");
    console.log("Attestation Asset ID:", value.assetId);
    console.log("Attestation Request ID:", value.requestId);
    console.log("Attestation State:", value.state);
    console.log("Signer Address:", attester.account.address);
    console.log("Signature Verification Result: SUCCESS");
    console.log("Transaction Hash:", attestationTx);
    console.log("Block Number:", receipt.blockNumber.toString());
    console.log("Vault Request State:", "CLAIMABLE (4)");
    console.log("Claimable Shares Calculated:", req.claimableShares.toString());
    console.log("Alice Minted Shares:", aliceShares.toString(), "(0 shares)");
    console.log("Events Count:", receipt.logs.length);
  });
});
