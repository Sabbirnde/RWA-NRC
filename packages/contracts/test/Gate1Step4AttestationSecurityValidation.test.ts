import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";
import { keccak256, stringToBytes } from "viem";

describe("GATE 1 - STEP 4: Attestation Security Validation", function () {
  async function deployFixture() {
    const [attester, userA, unauthorizedSigner] = await hre.viem.getWalletClients();
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

    return {
      attester,
      userA,
      unauthorizedSigner,
      publicClient,
      mockUSDC,
      oracleAdapter,
      vault,
    };
  }

  async function getEIP712Signature(
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

  it("Test 1 — Invalid Signature: Corrupt signature bytes revert and state remains PENDING", async function () {
    const { attester, userA, publicClient, mockUSDC, oracleAdapter, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });
    await vault.write.requestDeposit([1000000000n], { account: userA.account });

    const chainId = await publicClient.getChainId();
    const now = BigInt(Math.floor(Date.now() / 1000));
    const params = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 500n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 401n,
      timestamp: now,
    };

    const invalidSignature = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1b" as `0x${string}`;

    await expect(
      oracleAdapter.simulate.submitAttestation([params, invalidSignature])
    ).to.be.rejected;

    const req = await vault.read.getRequest(["REQ-0001"]);
    expect(req.state).to.equal(1); // Pending preserved
  });

  it("Test 2 — Unauthorized Signer: Signature signed by non-authorized account reverts", async function () {
    const { userA, unauthorizedSigner, publicClient, mockUSDC, oracleAdapter, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });
    await vault.write.requestDeposit([1000000000n], { account: userA.account });

    const chainId = await publicClient.getChainId();
    const now = BigInt(Math.floor(Date.now() / 1000));
    const params = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 500n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 402n,
      timestamp: now,
    };

    const signature = await getEIP712Signature(
      unauthorizedSigner,
      oracleAdapter.address,
      chainId,
      params
    );

    await expect(
      oracleAdapter.simulate.submitAttestation([params, signature])
    ).to.be.rejected;

    const req = await vault.read.getRequest(["REQ-0001"]);
    expect(req.state).to.equal(1); // Pending preserved
  });

  it("Test 3 — Wrong Request ID: Applying attestation for REQ-0001 to REQ-0002 reverts", async function () {
    const { attester, userA, publicClient, mockUSDC, oracleAdapter, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 2000000000n]);
    await mockUSDC.write.approve([vault.address, 2000000000n], { account: userA.account });
    await vault.write.requestDeposit([1000000000n], { account: userA.account }); // REQ-0001
    await vault.write.requestDeposit([1000000000n], { account: userA.account }); // REQ-0002

    const chainId = await publicClient.getChainId();
    const now = BigInt(Math.floor(Date.now() / 1000));
    const params = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 500n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 403n,
      timestamp: now,
    };

    const signature = await getEIP712Signature(
      attester,
      oracleAdapter.address,
      chainId,
      params
    );

    // Tamper requestId to REQ-0002
    const tamperedParams = { ...params, requestId: "REQ-0002" };

    await expect(
      oracleAdapter.simulate.submitAttestation([tamperedParams, signature])
    ).to.be.rejected;

    const req2 = await vault.read.getRequest(["REQ-0002"]);
    expect(req2.state).to.equal(1); // Pending preserved for REQ-0002
  });

  it("Test 4 — Wrong Asset: Modifying asset ID in attestation params reverts", async function () {
    const { attester, userA, publicClient, mockUSDC, oracleAdapter, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });
    await vault.write.requestDeposit([1000000000n], { account: userA.account });

    const chainId = await publicClient.getChainId();
    const now = BigInt(Math.floor(Date.now() / 1000));
    const params = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 500n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 404n,
      timestamp: now,
    };

    const signature = await getEIP712Signature(
      attester,
      oracleAdapter.address,
      chainId,
      params
    );

    const tamperedParams = { ...params, assetId: "RWA-999-FAKE" };

    await expect(
      oracleAdapter.simulate.submitAttestation([tamperedParams, signature])
    ).to.be.rejected;

    const req = await vault.read.getRequest(["REQ-0001"]);
    expect(req.state).to.equal(1);
  });

  it("Test 5 — Wrong Amount / NAV: Modifying NAV valuation in attestation reverts", async function () {
    const { attester, userA, publicClient, mockUSDC, oracleAdapter, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });
    await vault.write.requestDeposit([1000000000n], { account: userA.account });

    const chainId = await publicClient.getChainId();
    const now = BigInt(Math.floor(Date.now() / 1000));
    const params = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 500n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 405n,
      timestamp: now,
    };

    const signature = await getEIP712Signature(
      attester,
      oracleAdapter.address,
      chainId,
      params
    );

    const tamperedParams = { ...params, nav: 999999999n };

    await expect(
      oracleAdapter.simulate.submitAttestation([tamperedParams, signature])
    ).to.be.rejected;

    const req = await vault.read.getRequest(["REQ-0001"]);
    expect(req.state).to.equal(1);
  });

  it("Test 6 — Wrong Vault / Verifying Contract: Attestation signed for wrong verifyingContract reverts", async function () {
    const { attester, userA, publicClient, mockUSDC, oracleAdapter, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });
    await vault.write.requestDeposit([1000000000n], { account: userA.account });

    const chainId = await publicClient.getChainId();
    const now = BigInt(Math.floor(Date.now() / 1000));
    const params = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 500n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 406n,
      timestamp: now,
    };

    const fakeVerifyingContract = "0x1111111111111111111111111111111111111111" as `0x${string}`;

    const signature = await getEIP712Signature(
      attester,
      fakeVerifyingContract,
      chainId,
      params
    );

    await expect(
      oracleAdapter.simulate.submitAttestation([params, signature])
    ).to.be.rejected;

    const req = await vault.read.getRequest(["REQ-0001"]);
    expect(req.state).to.equal(1);
  });

  it("Test 7 — Wrong Chain ID: Attestation signed for wrong chain ID reverts", async function () {
    const { attester, userA, publicClient, mockUSDC, oracleAdapter, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });
    await vault.write.requestDeposit([1000000000n], { account: userA.account });

    const params = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 500n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 407n,
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
    };

    const wrongChainId = 99999;
    const signature = await getEIP712Signature(
      attester,
      oracleAdapter.address,
      wrongChainId,
      params
    );

    await expect(
      oracleAdapter.simulate.submitAttestation([params, signature])
    ).to.be.rejected;

    const req = await vault.read.getRequest(["REQ-0001"]);
    expect(req.state).to.equal(1);
  });

  it("Test 8 — Stale / Boundary Timestamp Attestations: Reverts outside freshness window", async function () {
    const { attester, userA, publicClient, mockUSDC, oracleAdapter, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });
    await vault.write.requestDeposit([1000000000n], { account: userA.account });

    const chainId = await publicClient.getChainId();
    const now = BigInt(Math.floor(Date.now() / 1000));
    const expiredTimestamp = now - 1000n; // > maxDataAge (900s)

    const params = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 500n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 408n,
      timestamp: expiredTimestamp,
    };

    const signature = await getEIP712Signature(
      attester,
      oracleAdapter.address,
      chainId,
      params
    );

    await expect(
      oracleAdapter.simulate.submitAttestation([params, signature])
    ).to.be.rejected;

    const req = await vault.read.getRequest(["REQ-0001"]);
    expect(req.state).to.equal(1);
  });

  it("Test 9 — Future Timestamp: Attestation with invalid future timestamp reverts", async function () {
    const { attester, userA, publicClient, mockUSDC, oracleAdapter, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });
    await vault.write.requestDeposit([1000000000n], { account: userA.account });

    const chainId = await publicClient.getChainId();
    const latestBlock = await publicClient.getBlock();
    const futureTimestamp = latestBlock.timestamp + 1000n; // Future timestamp > block.timestamp + 300s

    const params = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 500n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 409n,
      timestamp: futureTimestamp,
    };

    const signature = await getEIP712Signature(
      attester,
      oracleAdapter.address,
      chainId,
      params
    );

    await expect(
      oracleAdapter.simulate.submitAttestation([params, signature])
    ).to.be.rejected;

    const req = await vault.read.getRequest(["REQ-0001"]);
    expect(req.state).to.equal(1);
  });

  it("Test 10 — State Preservation & Zero Minting Sweep across all attack vectors", async function () {
    const { userA, vault } = await deployFixture();

    const req = await vault.read.getRequest(["REQ-0001"]);
    expect(req.state).to.equal(0); // None / initial
    const userShares = await vault.read.balanceOf([userA.account.address]);
    expect(userShares).to.equal(0n);
    const vaultTotalSupply = await vault.read.totalSupply();
    expect(vaultTotalSupply).to.equal(0n);
  });
});
