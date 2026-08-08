import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 7 — H2 Step 5: Attestation Security Boundary Validation Suite", function () {
  async function deployFixture() {
    const [deployer, attester, attacker, alice] = await hre.viem.getWalletClients();
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

    // Create REQ-0001 (#H2-001) and REQ-0002 (#H2-003)
    await mockUSDC.write.approve([vault.address, 2000000000n], { account: alice.account });
    await vault.write.requestDeposit([1000000000n], { account: alice.account }); // REQ-0001
    await vault.write.requestDeposit([1000000000n], { account: alice.account }); // REQ-0002 (#H2-003)

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

    return {
      deployer,
      attester,
      attacker,
      alice,
      publicClient,
      oracleAdapter,
      vault,
      domain,
      types,
    };
  }

  it("1. Missing Attestation — Direct claimShares without attestation reverts with RequestNotClaimable()", async function () {
    const { vault, alice } = await deployFixture();
    await expect(vault.write.claimShares(["REQ-0002"], { account: alice.account })).to.be.rejectedWith("RequestNotClaimable");
  });

  it("2. Invalid Signature — Attestation signed by non-authorized attacker reverts with UnauthorizedSigner()", async function () {
    const { attacker, oracleAdapter, domain, types } = await deployFixture();
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const value = {
      assetId: "RWA-001",
      requestId: "REQ-0002",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: 201n,
      timestamp,
    };
    const badSignature = await attacker.signTypedData({ domain, types, primaryType: "Attestation", message: value });
    await expect(oracleAdapter.write.submitAttestation([value, badSignature])).to.be.rejectedWith("UnauthorizedSigner");
  });

  it("3. Expired Attestation — Attestation with 37m old timestamp reverts with StaleAttestation()", async function () {
    const { attester, oracleAdapter, domain, types } = await deployFixture();
    const staleTimestamp = BigInt(Math.floor(Date.now() / 1000) - 2220); // 37 minutes old
    const value = {
      assetId: "RWA-001",
      requestId: "REQ-0002",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: 202n,
      timestamp: staleTimestamp,
    };
    const signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });
    await expect(oracleAdapter.write.submitAttestation([value, signature])).to.be.rejectedWith("StaleAttestation");
  });

  it("4. Replaying #H2-001 Attestation on #H2-003 (Wrong Request ID) — Signature mismatch reverts with UnauthorizedSigner()", async function () {
    const { attester, oracleAdapter, domain, types } = await deployFixture();
    const timestamp = BigInt(Math.floor(Date.now() / 1000));

    // Attestation signed specifically for REQ-0001 (#H2-001)
    const validValue001 = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: 203n,
      timestamp,
    };
    const signature001 = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: validValue001 });

    // Attempting to submit REQ-0001 signature for REQ-0002 (#H2-003) payload
    const replayedValue003 = { ...validValue001, requestId: "REQ-0002" };
    await expect(oracleAdapter.write.submitAttestation([replayedValue003, signature001])).to.be.rejectedWith("UnauthorizedSigner");
  });

  it("5. Wrong Asset ID — Modifying assetId field in signed struct reverts with UnauthorizedSigner()", async function () {
    const { attester, oracleAdapter, domain, types } = await deployFixture();
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const originalValue = {
      assetId: "RWA-001",
      requestId: "REQ-0002",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: 204n,
      timestamp,
    };
    const signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: originalValue });

    const tamperedValue = { ...originalValue, assetId: "RWA-999" };
    await expect(oracleAdapter.write.submitAttestation([tamperedValue, signature])).to.be.rejectedWith("UnauthorizedSigner");
  });

  it("6. Mismatched NAV Valuation — Modifying NAV field in signed struct reverts with UnauthorizedSigner()", async function () {
    const { attester, oracleAdapter, domain, types } = await deployFixture();
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const originalValue = {
      assetId: "RWA-001",
      requestId: "REQ-0002",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: 205n,
      timestamp,
    };
    const signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: originalValue });

    const tamperedValue = { ...originalValue, nav: 999999999n };
    await expect(oracleAdapter.write.submitAttestation([tamperedValue, signature])).to.be.rejectedWith("UnauthorizedSigner");
  });
});
