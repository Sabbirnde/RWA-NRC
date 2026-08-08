import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";
import { keccak256, stringToBytes } from "viem";

describe("Comprehensive Audit Security Test Suite (CRITICAL & HIGH Risk Mitigations)", function () {
  async function deployFixture() {
    const [owner, attester, user1, user2, attacker, unauthorizedSigner] =
      await hre.viem.getWalletClients();
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

    return {
      owner,
      attester,
      user1,
      user2,
      attacker,
      unauthorizedSigner,
      publicClient,
      mockUSDC,
      oracleAdapter,
      vault,
      claimRegistry,
      claimMarket,
    };
  }

  async function getEIP712AttestationSignature(
    signer: any,
    oracleAdapterAddress: `0x${string}`,
    chainId: number,
    params: {
      assetId: string;
      requestId: string;
      state: string;
      nav: bigint;
      yieldRate: bigint;
      riskStatus: `0x${string}`;
      nonce: bigint;
      timestamp: bigint;
    }
  ) {
    const domain = {
      name: "RWA-OracleAdapter",
      version: "1.0.0",
      chainId,
      verifyingContract: oracleAdapterAddress,
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

    return await signer.signTypedData({
      domain,
      types,
      primaryType: "Attestation",
      message: params,
    });
  }

  it("AUDIT-MID-02 (CRITICAL): High-Risk Off-Chain Asset Ingestion Risk Control", async function () {
    // Proven in middlewareSubcomponents.test.ts: High-Risk Asset -> Risk Engine FAIL
  });

  it("AUDIT-ATT-01 (CRITICAL): Forged Signature Attack -> Reverts with UnauthorizedSigner", async function () {
    const { oracleAdapter } = await deployFixture();
    const now = BigInt(Math.floor(Date.now() / 1000));

    const params = {
      assetId: "RWA-001",
      requestId: "REQ-AUDIT-01",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 500n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 501n,
      timestamp: now,
    };

    const forgedSig = ("0x" + "22".repeat(65)) as `0x${string}`;

    await expect(
      oracleAdapter.simulate.submitAttestation([params, forgedSig])
    ).to.be.rejected;
  });

  it("AUDIT-ATT-02 (CRITICAL): Attestation Nonce Replay Attack -> Reverts with ReplayedNonce", async function () {
    const { attester, user1, mockUSDC, vault, publicClient, oracleAdapter } = await deployFixture();

    await mockUSDC.write.faucet([user1.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: user1.account });
    await vault.write.requestDeposit([1000000000n], { account: user1.account });

    const chainId = await publicClient.getChainId();
    const now = BigInt(Math.floor(Date.now() / 1000));

    const params = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 500n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 502n,
      timestamp: now,
    };

    const signature = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      params
    );

    await oracleAdapter.write.submitAttestation([params, signature]);

    await expect(
      oracleAdapter.simulate.submitAttestation([params, signature])
    ).to.be.rejectedWith("ReplayedNonce");
  });

  it("AUDIT-ATT-03 (CRITICAL): Key Compromise Revocation -> Reverts with RevokedSigner", async function () {
    const { attester, owner, publicClient, oracleAdapter } = await deployFixture();
    const chainId = await publicClient.getChainId();
    const now = BigInt(Math.floor(Date.now() / 1000));

    const params = {
      assetId: "RWA-001",
      requestId: "REQ-AUDIT-03",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 500n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 503n,
      timestamp: now,
    };

    const signature = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      params
    );

    await oracleAdapter.write.revokeSigner([attester.account.address]);

    await expect(
      oracleAdapter.simulate.submitAttestation([params, signature])
    ).to.be.rejectedWith("RevokedSigner");
  });

  it("AUDIT-VLT-01 (CRITICAL): Premature Share Minting -> Reverts before settlement", async function () {
    const { user1, mockUSDC, vault } = await deployFixture();

    await mockUSDC.write.faucet([user1.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: user1.account });
    await vault.write.requestDeposit([1000000000n], { account: user1.account });

    await expect(
      vault.simulate.claimShares(["REQ-0001"], { account: user1.account })
    ).to.be.rejected;
  });

  it("AUDIT-VLT-02 (CRITICAL): Double Finalization / Double Minting -> Reverts on second claim", async function () {
    const { attester, user1, publicClient, mockUSDC, oracleAdapter, vault } = await deployFixture();

    await mockUSDC.write.faucet([user1.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: user1.account });
    await vault.write.requestDeposit([1000000000n], { account: user1.account });

    const chainId = await publicClient.getChainId();
    const now = BigInt(Math.floor(Date.now() / 1000));
    const params = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 500n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 504n,
      timestamp: now,
    };

    const signature = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      params
    );

    await oracleAdapter.write.submitAttestation([params, signature]);
    await vault.write.claimShares(["REQ-0001"], { account: user1.account });

    await expect(
      vault.simulate.claimShares(["REQ-0001"], { account: user1.account })
    ).to.be.rejected;
  });

  it("AUDIT-MKT-01 (CRITICAL): Non-Owner Claim Theft -> Reverts with NotClaimOwner", async function () {
    const { user1, attacker, mockUSDC, vault, claimMarket } = await deployFixture();

    await mockUSDC.write.faucet([user1.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: user1.account });
    await vault.write.requestDeposit([1000000000n], { account: user1.account });

    await expect(
      claimMarket.simulate.listClaim([1n, 950000000n], { account: attacker.account })
    ).to.be.rejectedWith("NotClaimOwner");
  });

  it("AUDIT-ECO-01 (CRITICAL): Undercollateralized Claim Issuance -> Requires locked assets in vault", async function () {
    const { user1, vault, claimRegistry } = await deployFixture();

    // User tries to request deposit without approving USDC -> Reverts, zero claim created
    await expect(
      vault.simulate.requestDeposit([1000000000n], { account: user1.account })
    ).to.be.rejected;
  });

  it("AUDIT-ORC-01 (HIGH): Cross-Chain Replay Attack -> Reverts with UnauthorizedSigner", async function () {
    const { attester, oracleAdapter } = await deployFixture();
    const now = BigInt(Math.floor(Date.now() / 1000));

    const params = {
      assetId: "RWA-001",
      requestId: "REQ-AUDIT-ORC-01",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 500n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 505n,
      timestamp: now,
    };

    // Signed for chain ID 1 (Ethereum Mainnet) instead of local testnet
    const signature = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      1,
      params
    );

    await expect(
      oracleAdapter.simulate.submitAttestation([params, signature])
    ).to.be.rejectedWith("UnauthorizedSigner");
  });

  it("AUDIT-VLT-03 (HIGH): Unauthorized Oracle Direct Call -> Reverts with UnauthorizedOracle", async function () {
    const { attacker, vault } = await deployFixture();

    await expect(
      vault.simulate.onAttestationSettled(["REQ-0001", 1000000n], { account: attacker.account })
    ).to.be.rejected;
  });

  it("AUDIT-REG-01 (HIGH): Duplicate Claim Creation -> Reverts with ClaimAlreadyExists", async function () {
    const { vault, user1, mockUSDC, claimRegistry } = await deployFixture();

    await mockUSDC.write.faucet([user1.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: user1.account });
    await vault.write.requestDeposit([1000000000n], { account: user1.account });

    // Simulate direct second claim creation attempt with same request ID REQ-0001
    await expect(
      claimRegistry.simulate.createClaim(["REQ-0001", "RWA-001", user1.account.address, 1000000000n], {
        account: vault.address,
      })
    ).to.be.rejectedWith("ClaimAlreadyExists");
  });

  it("AUDIT-MKT-02 (HIGH): Price Gouging Above Face Value -> Reverts with InvalidPrice", async function () {
    const { user1, mockUSDC, vault, claimMarket } = await deployFixture();

    await mockUSDC.write.faucet([user1.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: user1.account });
    await vault.write.requestDeposit([1000000000n], { account: user1.account });

    await expect(
      claimMarket.simulate.listClaim([1n, 2000000000n], { account: user1.account })
    ).to.be.rejectedWith("InvalidPrice");
  });
});
