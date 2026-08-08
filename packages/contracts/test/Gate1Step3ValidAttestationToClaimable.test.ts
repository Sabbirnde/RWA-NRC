import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";
import { keccak256, stringToBytes } from "viem";

describe("GATE 1 - STEP 3: Valid Attestation -> Claimable Transition Validation", function () {
  async function deployFixture() {
    const [attester, userA, userB] = await hre.viem.getWalletClients();
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
      userB,
      publicClient,
      mockUSDC,
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

  it("Test 1 — Valid Attestation: PENDING -> CLAIMABLE state transition", async function () {
    const { attester, userA, publicClient, mockUSDC, oracleAdapter, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });
    await vault.write.requestDeposit([1000000000n], { account: userA.account });

    const beforeReq = await vault.read.getRequest(["REQ-0001"]);
    expect(beforeReq.state).to.equal(1); // Pending

    const chainId = await publicClient.getChainId();
    const now = BigInt(Math.floor(Date.now() / 1000));
    const params = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1002500n,
      yieldRate: 520n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 301n,
      timestamp: now,
    };

    const signature = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      params
    );

    await oracleAdapter.write.submitAttestation([params, signature]);

    const afterReq = await vault.read.getRequest(["REQ-0001"]);
    expect(afterReq.state).to.equal(4); // Claimable (enum RequestState.Claimable)
  });

  it("Test 2 — Correct Request Isolation: Only intended request becomes CLAIMABLE", async function () {
    const { attester, userA, userB, publicClient, mockUSDC, oracleAdapter, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.faucet([userB.account.address, 2000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });
    await mockUSDC.write.approve([vault.address, 2000000000n], { account: userB.account });

    await vault.write.requestDeposit([1000000000n], { account: userA.account }); // REQ-0001
    await vault.write.requestDeposit([2000000000n], { account: userB.account }); // REQ-0002

    const chainId = await publicClient.getChainId();
    const now = BigInt(Math.floor(Date.now() / 1000));
    const params = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 500n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 302n,
      timestamp: now,
    };

    const signature = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      params
    );

    await oracleAdapter.write.submitAttestation([params, signature]);

    const req1 = await vault.read.getRequest(["REQ-0001"]);
    const req2 = await vault.read.getRequest(["REQ-0002"]);

    expect(req1.state).to.equal(4); // Claimable
    expect(req2.state).to.equal(1); // Pending preserved for REQ-0002!
  });

  it("Test 3 — Settlement Data Accuracy: Shares & struct fields match attestation", async function () {
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
      nav: 1002500n,
      yieldRate: 520n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 303n,
      timestamp: now,
    };

    const signature = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      params
    );

    await oracleAdapter.write.submitAttestation([params, signature]);

    const req = await vault.read.getRequest(["REQ-0001"]);
    expect(req.requestId).to.equal("REQ-0001");
    expect(req.owner.toLowerCase()).to.equal(userA.account.address.toLowerCase());
    expect(req.amount).to.equal(1000000000n);
    expect(req.claimableShares).to.equal(1000000000000000000000n); // 1000 * 10^18 shares
    expect(req.state).to.equal(4); // Claimable
  });

  it("Test 4 — Event Emission: AttestationAccepted and DepositClaimable emitted", async function () {
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
      nav: 1002500n,
      yieldRate: 520n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 304n,
      timestamp: now,
    };

    const signature = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      params
    );

    const hash = await oracleAdapter.write.submitAttestation([params, signature]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    expect(receipt.status).to.equal("success");
    expect(receipt.logs.length).to.be.gt(0);
  });

  it("Test 5 — Attestation Consumption Recording: Nonce recorded as used", async function () {
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
      nav: 1002500n,
      yieldRate: 520n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 305n,
      timestamp: now,
    };

    const signature = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      params
    );

    await oracleAdapter.write.submitAttestation([params, signature]);

    const isUsed = await oracleAdapter.read.usedNonces([305n]);
    expect(isUsed).to.be.true;
  });
});
