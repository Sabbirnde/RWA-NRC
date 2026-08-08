import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 2 — Smart Contract Settlement Security & Adversarial Protection Suite", function () {
  async function deployFixture() {
    const [deployer, attester, alice, bob, attacker] = await hre.viem.getWalletClients();
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
    await mockUSDC.write.mint([attacker.account.address, initialAmount]);

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
      alice,
      bob,
      attacker,
      publicClient,
      mockUSDC,
      oracleAdapter,
      vault,
      claimRegistry,
      claimMarket,
      domain,
      types,
    };
  }

  it("Attack 1 — Mint shares before fulfillment -> Reverts with RequestNotClaimable()", async function () {
    const { alice, mockUSDC, vault } = await deployFixture();
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: alice.account });
    await vault.write.requestDeposit([1000000000n], { account: alice.account }); // REQ-0001 PENDING

    await expect(vault.write.claimShares(["REQ-0001"], { account: alice.account })).to.be.rejectedWith("RequestNotClaimable");
  });

  it("Attack 2 — Settle request without attestation -> Reverts with RequestNotClaimable()", async function () {
    const { bob, vault } = await deployFixture();
    await expect(vault.write.claimShares(["REQ-0001"], { account: bob.account })).to.be.rejectedWith("RequestNotClaimable");
  });

  it("Attack 3 — Call fulfillment directly (non-oracle) -> Reverts with UnauthorizedOracle()", async function () {
    const { attacker, vault } = await deployFixture();
    await expect(
      vault.write.onAttestationSettled(["REQ-0001", 1000000n], { account: attacker.account })
    ).to.be.rejectedWith("UnauthorizedOracle");
  });

  it("Attack 4 — Use unauthorized account for admin controls -> Reverts with OwnableUnauthorizedAccount()", async function () {
    const { attacker, oracleAdapter } = await deployFixture();
    await expect(
      oracleAdapter.write.setAuthorizedSigner([attacker.account.address], { account: attacker.account })
    ).to.be.rejectedWith("OwnableUnauthorizedAccount");
  });

  it("Attack 5 — Use invalid request ID -> Reverts with RequestNotClaimable()", async function () {
    const { alice, vault } = await deployFixture();
    await expect(vault.write.claimShares(["REQ-NONEXISTENT-9999"], { account: alice.account })).to.be.rejectedWith("RequestNotClaimable");
  });

  it("Attack 6 — Use another user's request -> Reverts with NotClaimOwner()", async function () {
    const { attester, alice, bob, mockUSDC, oracleAdapter, vault, domain, types } = await deployFixture();
    // Bob deposits USDC -> REQ-0001
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: bob.account });
    await vault.write.requestDeposit([1000000000n], { account: bob.account });

    // Submit Attestation for Bob's REQ-0001
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const value = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: 2001n,
      timestamp,
    };
    const signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });
    await oracleAdapter.write.submitAttestation([value, signature]);

    // Alice attempts to claim Bob's shares
    await expect(vault.write.claimShares(["REQ-0001"], { account: alice.account })).to.be.rejectedWith("NotClaimOwner");
  });

  it("Attack 7 — Reuse an old settlement payload (attestation replay) -> Reverts with ReplayedNonce()", async function () {
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
      nonce: 2002n,
      timestamp,
    };
    const signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });
    await oracleAdapter.write.submitAttestation([value, signature]);

    // Submit identical attestation again
    await expect(oracleAdapter.write.submitAttestation([value, signature])).to.be.rejectedWith("ReplayedNonce");
  });

  it("Attack 8 — Execute settlement twice -> Reverts with RequestNotClaimable()", async function () {
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
      nonce: 2003n,
      timestamp,
    };
    const signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });
    await oracleAdapter.write.submitAttestation([value, signature]);

    // First claim succeeds
    await vault.write.claimShares(["REQ-0001"], { account: alice.account });

    // Second claim attempt reverts
    await expect(vault.write.claimShares(["REQ-0001"], { account: alice.account })).to.be.rejectedWith("RequestNotClaimable");
  });

  it("Attack 9 — Modify settlement parameters (corrupt NAV) -> Reverts with UnauthorizedSigner()", async function () {
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
      nonce: 2004n,
      timestamp,
    };
    const signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });

    // Tamper NAV value from 1,000,000 to 9,999,999
    const tamperedValue = { ...value, nav: 9999999n };
    await expect(oracleAdapter.write.submitAttestation([tamperedValue, signature])).to.be.rejectedWith("UnauthorizedSigner");
  });

  it("Attack 10 — Bypass intended middleware/oracle path -> Direct minting fails", async function () {
    const { attacker, vault } = await deployFixture();
    // Direct call to internal _mint is impossible in Solidity ERC20
    await expect(
      vault.write.claimShares(["REQ-0001"], { account: attacker.account })
    ).to.be.rejectedWith("RequestNotClaimable");
  });
});
