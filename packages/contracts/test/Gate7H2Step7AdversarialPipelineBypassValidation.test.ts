import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 7 — H2 Step 7: Adversarial Middleware Bypass Validation Suite", function () {
  async function deployFixture() {
    const [deployer, attester, attacker, alice, bob] = await hre.viem.getWalletClients();
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

    // Create deposit requests
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: alice.account });
    await vault.write.requestDeposit([1000000000n], { account: alice.account }); // REQ-0001 (H2-001)

    await mockUSDC.write.approve([vault.address, 1000000000n], { account: bob.account });
    await vault.write.requestDeposit([1000000000n], { account: bob.account }); // REQ-0002 (H2-003 - Stale Data Payload)

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
      attacker,
      bob,
      oracleAdapter,
      vault,
      domain,
      types,
    };
  }

  it("Attack Vector 1 — Direct settlement without attestation", async function () {
    const { bob, vault } = await deployFixture();
    await expect(vault.write.claimShares(["REQ-0002"], { account: bob.account })).to.be.rejectedWith("RequestNotClaimable");
    const req = await vault.read.getRequest(["REQ-0002"]);
    const bobBalance = await vault.read.balanceOf([bob.account.address]);
    expect(req.state).to.equal(1); // PENDING
    expect(bobBalance).to.equal(0n);
  });

  it("Attack Vector 2 — Settlement with an invalid signature (Attacker Key)", async function () {
    const { attacker, oracleAdapter, vault, bob, domain, types } = await deployFixture();
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const value = {
      assetId: "RWA-001",
      requestId: "REQ-0002",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: 301n,
      timestamp,
    };
    const badSig = await attacker.signTypedData({ domain, types, primaryType: "Attestation", message: value });
    await expect(oracleAdapter.write.submitAttestation([value, badSig])).to.be.rejectedWith("UnauthorizedSigner");
    const req = await vault.read.getRequest(["REQ-0002"]);
    const bobBalance = await vault.read.balanceOf([bob.account.address]);
    expect(req.state).to.equal(1); // PENDING
    expect(bobBalance).to.equal(0n);
  });

  it("Attack Vector 3 — Settlement with an expired attestation (37m old timestamp)", async function () {
    const { attester, oracleAdapter, vault, bob, domain, types } = await deployFixture();
    const staleTimestamp = BigInt(Math.floor(Date.now() / 1000) - 2220); // 37m old
    const value = {
      assetId: "RWA-001",
      requestId: "REQ-0002",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: 302n,
      timestamp: staleTimestamp,
    };
    const sig = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });
    await expect(oracleAdapter.write.submitAttestation([value, sig])).to.be.rejectedWith("StaleAttestation");
    const req = await vault.read.getRequest(["REQ-0002"]);
    const bobBalance = await vault.read.balanceOf([bob.account.address]);
    expect(req.state).to.equal(1); // PENDING
    expect(bobBalance).to.equal(0n);
  });

  it("Attack Vector 4 — Settlement with an attestation for another request (Cross-Request Replay)", async function () {
    const { attester, oracleAdapter, vault, bob, domain, types } = await deployFixture();
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const value001 = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: 303n,
      timestamp,
    };
    const sig001 = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value001 });
    const replayedValue002 = { ...value001, requestId: "REQ-0002" };
    await expect(oracleAdapter.write.submitAttestation([replayedValue002, sig001])).to.be.rejectedWith("UnauthorizedSigner");
    const req = await vault.read.getRequest(["REQ-0002"]);
    const bobBalance = await vault.read.balanceOf([bob.account.address]);
    expect(req.state).to.equal(1); // PENDING
    expect(bobBalance).to.equal(0n);
  });

  it("Attack Vector 5 — Settlement with an attestation for another asset ID", async function () {
    const { attester, oracleAdapter, vault, bob, domain, types } = await deployFixture();
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const value = {
      assetId: "RWA-001",
      requestId: "REQ-0002",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: 304n,
      timestamp,
    };
    const sig = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });
    const tamperedAsset = { ...value, assetId: "RWA-999" };
    await expect(oracleAdapter.write.submitAttestation([tamperedAsset, sig])).to.be.rejectedWith("UnauthorizedSigner");
    const req = await vault.read.getRequest(["REQ-0002"]);
    const bobBalance = await vault.read.balanceOf([bob.account.address]);
    expect(req.state).to.equal(1); // PENDING
    expect(bobBalance).to.equal(0n);
  });

  it("Attack Vector 6 — Settlement with mismatched state / NAV valuation", async function () {
    const { attester, oracleAdapter, vault, bob, domain, types } = await deployFixture();
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const value = {
      assetId: "RWA-001",
      requestId: "REQ-0002",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: 305n,
      timestamp,
    };
    const sig = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });
    const tamperedNAV = { ...value, nav: 999999999999n };
    await expect(oracleAdapter.write.submitAttestation([tamperedNAV, sig])).to.be.rejectedWith("UnauthorizedSigner");
    const req = await vault.read.getRequest(["REQ-0002"]);
    const bobBalance = await vault.read.balanceOf([bob.account.address]);
    expect(req.state).to.equal(1); // PENDING
    expect(bobBalance).to.equal(0n);
  });
});
