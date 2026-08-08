import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 5 — External-State Safety & Attestation Boundary Protection Suite (H2 Validation)", function () {
  async function deployFixture() {
    const [deployer, attester, unauthorizedSigner, alice] = await hre.viem.getWalletClients();
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

    await assetRegistry.write.setOracleAdapter([oracleAdapter.address]);
    await oracleAdapter.write.setVault([vault.address]);
    await vault.write.setOracleAdapter([oracleAdapter.address]);
    await claimRegistry.write.setVault([vault.address]);

    const initialAmount = 100000000000n; // 100,000 USDC
    await mockUSDC.write.mint([alice.account.address, initialAmount]);

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
      attester,
      unauthorizedSigner,
      alice,
      publicClient,
      mockUSDC,
      oracleAdapter,
      vault,
      domain,
      types,
    };
  }

  describe("PART A — Freshness Thresholding", function () {
    it("Fresh Data (Data age < 300s) -> Attestation accepted & Vault transitions to CLAIMABLE", async function () {
      const { attester, alice, mockUSDC, oracleAdapter, vault, domain, types } = await deployFixture();
      await mockUSDC.write.approve([vault.address, 1000000000n], { account: alice.account });
      await vault.write.requestDeposit([1000000000n], { account: alice.account });

      const timestamp = BigInt(Math.floor(Date.now() / 1000)); // Fresh (age = 0s)
      const value = {
        assetId: "RWA-001",
        requestId: "REQ-0001",
        state: "SETTLED",
        nav: 1000000n,
        yieldRate: 520n,
        riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
        nonce: 5001n,
        timestamp,
      };
      const signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });

      await oracleAdapter.write.submitAttestation([value, signature]);
      const req = await vault.read.getRequest(["REQ-0001"]);
      expect(req.state).to.equal(4); // CLAIMABLE
    });

    it("Stale Data (Data age > 300s) -> Reverts with StaleAttestation(); Request remains PENDING", async function () {
      const { attester, alice, mockUSDC, oracleAdapter, vault, domain, types } = await deployFixture();
      await mockUSDC.write.approve([vault.address, 1000000000n], { account: alice.account });
      await vault.write.requestDeposit([1000000000n], { account: alice.account });

      const staleTimestamp = BigInt(Math.floor(Date.now() / 1000) - 600); // 10 minutes old (>300s)
      const value = {
        assetId: "RWA-001",
        requestId: "REQ-0001",
        state: "SETTLED",
        nav: 1000000n,
        yieldRate: 520n,
        riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
        nonce: 5002n,
        timestamp: staleTimestamp,
      };
      const signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });

      await expect(oracleAdapter.write.submitAttestation([value, signature])).to.be.rejectedWith("StaleAttestation");
      const req = await vault.read.getRequest(["REQ-0001"]);
      expect(req.state).to.equal(1); // PENDING
    });
  });

  describe("PART C — Attestation Signature & Parameter Security", function () {
    it("Valid Attestation -> PASS", async function () {
      const { attester, alice, mockUSDC, oracleAdapter, vault, domain, types } = await deployFixture();
      await mockUSDC.write.approve([vault.address, 1000000000n], { account: alice.account });
      await vault.write.requestDeposit([1000000000n], { account: alice.account });

      const timestamp = BigInt(Math.floor(Date.now() / 1000));
      const value = {
        assetId: "RWA-001",
        requestId: "REQ-0001",
        state: "SETTLED",
        nav: 1000000n,
        yieldRate: 520n,
        riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
        nonce: 5003n,
        timestamp,
      };
      const signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });
      await oracleAdapter.write.submitAttestation([value, signature]);
      const req = await vault.read.getRequest(["REQ-0001"]);
      expect(req.state).to.equal(4); // CLAIMABLE
    });

    it("Invalid Signature -> Reverts with UnauthorizedSigner()", async function () {
      const { attester, alice, mockUSDC, oracleAdapter, domain, types } = await deployFixture();
      await mockUSDC.write.approve([vault.address, 1000000000n], { account: alice.account });
      await vault.write.requestDeposit([1000000000n], { account: alice.account });

      const timestamp = BigInt(Math.floor(Date.now() / 1000));
      const value = {
        assetId: "RWA-001",
        requestId: "REQ-0001",
        state: "SETTLED",
        nav: 1000000n,
        yieldRate: 520n,
        riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
        nonce: 5004n,
        timestamp,
      };
      let signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });
      // Corrupt signature bytes
      signature = ("0x" + "00".repeat(65)) as `0x${string}`;

      await expect(oracleAdapter.write.submitAttestation([value, signature])).to.be.rejectedWith("UnauthorizedSigner");
    });

    it("Wrong Signer -> Reverts with UnauthorizedSigner()", async function () {
      const { unauthorizedSigner, alice, mockUSDC, oracleAdapter, domain, types } = await deployFixture();
      await mockUSDC.write.approve([vault.address, 1000000000n], { account: alice.account });
      await vault.write.requestDeposit([1000000000n], { account: alice.account });

      const timestamp = BigInt(Math.floor(Date.now() / 1000));
      const value = {
        assetId: "RWA-001",
        requestId: "REQ-0001",
        state: "SETTLED",
        nav: 1000000n,
        yieldRate: 520n,
        riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
        nonce: 5005n,
        timestamp,
      };
      const signature = await unauthorizedSigner.signTypedData({ domain, types, primaryType: "Attestation", message: value });

      await expect(oracleAdapter.write.submitAttestation([value, signature])).to.be.rejectedWith("UnauthorizedSigner");
    });

    it("Future Timestamp -> Reverts with FutureAttestation()", async function () {
      const { attester, alice, mockUSDC, oracleAdapter, domain, types } = await deployFixture();
      await mockUSDC.write.approve([vault.address, 1000000000n], { account: alice.account });
      await vault.write.requestDeposit([1000000000n], { account: alice.account });

      const futureTimestamp = BigInt(Math.floor(Date.now() / 1000) + 3600); // 1 hour in future
      const value = {
        assetId: "RWA-001",
        requestId: "REQ-0001",
        state: "SETTLED",
        nav: 1000000n,
        yieldRate: 520n,
        riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
        nonce: 5006n,
        timestamp: futureTimestamp,
      };
      const signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });

      await expect(oracleAdapter.write.submitAttestation([value, signature])).to.be.rejectedWith("FutureAttestation");
    });
  });
});
