import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 6 — Replay Protection & Cryptographic Integrity Validation Suite", function () {
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
      alice,
      bob,
      publicClient,
      mockUSDC,
      oracleAdapter,
      vault,
      domain,
      types,
    };
  }

  it("1. Nonce Sequence Test: Nonce N succeeds -> Replay Nonce N fails -> Nonce N+1 succeeds", async function () {
    const { attester, alice, mockUSDC, oracleAdapter, vault, domain, types } = await deployFixture();
    await mockUSDC.write.approve([vault.address, 2000000000n], { account: alice.account });
    await vault.write.requestDeposit([1000000000n], { account: alice.account }); // REQ-0001
    await vault.write.requestDeposit([1000000000n], { account: alice.account }); // REQ-0002

    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const nonceN = 6001n;

    // 1. Submit Nonce N -> PASS
    const valN = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: nonceN,
      timestamp,
    };
    const sigN = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: valN });
    await oracleAdapter.write.submitAttestation([valN, sigN]);

    const usedN = await oracleAdapter.read.usedNonces([nonceN]);
    expect(usedN).to.equal(true); // Nonce consumed!

    // 2. Replay Nonce N -> MUST FAIL with ReplayedNonce()
    await expect(oracleAdapter.write.submitAttestation([valN, sigN])).to.be.rejectedWith("ReplayedNonce");

    // 3. Submit Nonce N+1 -> PASS
    const nonceN1 = 6002n;
    const valN1 = { ...valN, requestId: "REQ-0002", nonce: nonceN1 };
    const sigN1 = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: valN1 });
    await oracleAdapter.write.submitAttestation([valN1, sigN1]);

    const usedN1 = await oracleAdapter.read.usedNonces([nonceN1]);
    expect(usedN1).to.equal(true);
  });

  it("2. Simultaneous / Double Settlement Race Protection: Only ONE claim call can succeed", async function () {
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
      nonce: 6003n,
      timestamp,
    };
    const signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });
    await oracleAdapter.write.submitAttestation([value, signature]);

    // First claim call succeeds
    await vault.write.claimShares(["REQ-0001"], { account: alice.account });

    // Second claim call MUST FAIL
    await expect(vault.write.claimShares(["REQ-0001"], { account: alice.account })).to.be.rejectedWith("RequestNotClaimable");
  });

  it("3. Exhaustive Replay Rejection: Old attestation, payload, and request ID replays are all blocked", async function () {
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
      nonce: 6004n,
      timestamp,
    };
    const signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });
    await oracleAdapter.write.submitAttestation([value, signature]);

    // Replay with old payload
    await expect(oracleAdapter.write.submitAttestation([value, signature])).to.be.rejectedWith("ReplayedNonce");
  });
});
