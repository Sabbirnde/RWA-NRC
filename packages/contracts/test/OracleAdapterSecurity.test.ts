import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";
import { keccak256, stringToBytes } from "viem";

describe("Oracle Adapter Security & Attestation Verification Suite", function () {
  async function deployFixture() {
    const [owner, attester, user1, user2, unauthorizedSigner] =
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

    await assetRegistry.write.setOracleAdapter([oracleAdapter.address]);
    await vault.write.setOracleAdapter([oracleAdapter.address]);
    await claimRegistry.write.setVault([vault.address]);

    return {
      owner,
      attester,
      user1,
      user2,
      unauthorizedSigner,
      publicClient,
      mockUSDC,
      assetRegistry,
      oracleAdapter,
      vault,
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

  it("1. Forged Signature -> Should revert with UnauthorizedSigner", async function () {
    const { attester, publicClient, oracleAdapter } = await deployFixture();
    const chainId = await publicClient.getChainId();
    const now = BigInt(Math.floor(Date.now() / 1000));

    const params = {
      assetId: "RWA-001",
      requestId: "REQ-101",
      state: "SETTLED",
      nav: 1002500n,
      yieldRate: 520n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 101n,
      timestamp: now,
    };

    // Forged random 65-byte signature
    const forgedSignature = "0x" + "11".repeat(65) as `0x${string}`;

    await expect(
      oracleAdapter.simulate.submitAttestation([params, forgedSignature])
    ).to.be.rejected;
  });

  it("2. Modified Valuation -> Should revert with UnauthorizedSigner", async function () {
    const { attester, publicClient, oracleAdapter } = await deployFixture();
    const chainId = await publicClient.getChainId();
    const now = BigInt(Math.floor(Date.now() / 1000));

    const originalParams = {
      assetId: "RWA-001",
      requestId: "REQ-102",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 102n,
      timestamp: now,
    };

    const signature = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      originalParams
    );

    // Tamper valuation to 5,000,000
    const tamperedParams = { ...originalParams, nav: 5000000n };

    await expect(
      oracleAdapter.simulate.submitAttestation([tamperedParams, signature])
    ).to.be.rejectedWith("UnauthorizedSigner");
  });

  it("3. Modified Asset ID -> Should revert with UnauthorizedSigner", async function () {
    const { attester, publicClient, oracleAdapter } = await deployFixture();
    const chainId = await publicClient.getChainId();
    const now = BigInt(Math.floor(Date.now() / 1000));

    const originalParams = {
      assetId: "RWA-001",
      requestId: "REQ-103",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 103n,
      timestamp: now,
    };

    const signature = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      originalParams
    );

    const tamperedParams = { ...originalParams, assetId: "FORGED-ASSET" };

    await expect(
      oracleAdapter.simulate.submitAttestation([tamperedParams, signature])
    ).to.be.rejectedWith("UnauthorizedSigner");
  });

  it("4. Expired Attestation -> Should revert with StaleAttestation", async function () {
    const { attester, publicClient, oracleAdapter } = await deployFixture();
    const chainId = await publicClient.getChainId();
    const staleTime = BigInt(Math.floor(Date.now() / 1000) - 1800); // 30 mins ago (> 15m)

    const params = {
      assetId: "RWA-001",
      requestId: "REQ-104",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 104n,
      timestamp: staleTime,
    };

    const signature = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      params
    );

    await expect(
      oracleAdapter.simulate.submitAttestation([params, signature])
    ).to.be.rejectedWith("StaleAttestation");
  });

  it("5. Replayed Attestation & Duplicate Nonce -> Should revert with ReplayedNonce", async function () {
    const { attester, publicClient, oracleAdapter } = await deployFixture();
    const chainId = await publicClient.getChainId();
    const now = BigInt(Math.floor(Date.now() / 1000));

    const params = {
      assetId: "RWA-001",
      requestId: "REQ-105",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 105n,
      timestamp: now,
    };

    const signature = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      params
    );

    await oracleAdapter.write.submitAttestation([params, signature]);

    // Replay submission
    await expect(
      oracleAdapter.simulate.submitAttestation([params, signature])
    ).to.be.rejectedWith("ReplayedNonce");
  });

  it("6. Wrong Chain ID -> Should revert with UnauthorizedSigner", async function () {
    const { attester, oracleAdapter } = await deployFixture();
    const now = BigInt(Math.floor(Date.now() / 1000));

    const params = {
      assetId: "RWA-001",
      requestId: "REQ-106",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 106n,
      timestamp: now,
    };

    // Signed for Ethereum Mainnet (chainId = 1) instead of local testnet
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

  it("7. Wrong Contract Domain -> Should revert with UnauthorizedSigner", async function () {
    const { attester, publicClient, oracleAdapter } = await deployFixture();
    const chainId = await publicClient.getChainId();
    const now = BigInt(Math.floor(Date.now() / 1000));

    const params = {
      assetId: "RWA-001",
      requestId: "REQ-107",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 107n,
      timestamp: now,
    };

    // Signed for wrong contract address
    const signature = await getEIP712AttestationSignature(
      attester,
      "0x1111111111111111111111111111111111111111",
      chainId,
      params
    );

    await expect(
      oracleAdapter.simulate.submitAttestation([params, signature])
    ).to.be.rejectedWith("UnauthorizedSigner");
  });

  it("8. Unauthorized Signer -> Should revert with UnauthorizedSigner", async function () {
    const { unauthorizedSigner, publicClient, oracleAdapter } = await deployFixture();
    const chainId = await publicClient.getChainId();
    const now = BigInt(Math.floor(Date.now() / 1000));

    const params = {
      assetId: "RWA-001",
      requestId: "REQ-108",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 108n,
      timestamp: now,
    };

    const signature = await getEIP712AttestationSignature(
      unauthorizedSigner,
      oracleAdapter.address,
      chainId,
      params
    );

    await expect(
      oracleAdapter.simulate.submitAttestation([params, signature])
    ).to.be.rejectedWith("UnauthorizedSigner");
  });

  it("9. Key Revocation -> Revoked signer attestation should revert with RevokedSigner", async function () {
    const { attester, owner, publicClient, oracleAdapter } = await deployFixture();
    const chainId = await publicClient.getChainId();
    const now = BigInt(Math.floor(Date.now() / 1000));

    const params = {
      assetId: "RWA-001",
      requestId: "REQ-109",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 109n,
      timestamp: now,
    };

    const signature = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      params
    );

    // Revoke attester key
    await oracleAdapter.write.revokeSigner([attester.account.address]);

    await expect(
      oracleAdapter.simulate.submitAttestation([params, signature])
    ).to.be.rejectedWith("RevokedSigner");
  });
});
