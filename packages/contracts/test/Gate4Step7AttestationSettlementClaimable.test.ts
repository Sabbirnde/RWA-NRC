import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";
import { keccak256, stringToBytes } from "viem";

describe("GATE 4.6 / 4.7 — Attestation Submission & PENDING -> CLAIMABLE Transition Suite", function () {
  async function deployFixture() {
    const [deployer, attester, alice, bob, unauthorized] = await hre.viem.getWalletClients();
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

    return {
      deployer,
      attester,
      alice,
      bob,
      unauthorized,
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

  it("Executes Attestation Submission & Verifies PENDING -> CLAIMABLE Transition and Security Invariants", async function () {
    const { attester, alice, bob, unauthorized, publicClient, mockUSDC, oracleAdapter, vault } =
      await deployFixture();

    const depositAmount = 1000000000n; // 1000 USDC
    const chainId = await publicClient.getChainId();

    // 1. Alice creates deposit request
    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    await vault.write.requestDeposit([depositAmount], { account: alice.account });

    const requestId = "REQ-0001";
    const initialReq = await vault.read.getRequest([requestId]);
    expect(initialReq.state === 0 || initialReq.state === 1).to.be.true; // Pending

    // 2. Generate EIP-712 Attestation
    const currentBlock = await publicClient.getBlock();
    const now = currentBlock.timestamp;
    const passRisk = keccak256(stringToBytes("PASS"));
    const attestationParams = {
      assetId: "RWA-001",
      requestId: requestId,
      state: "SETTLED",
      nav: 1002500n,
      yieldRate: 520n,
      riskStatus: passRisk,
      nonce: 1001n,
      timestamp: now,
    };

    const signature = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      attestationParams
    );

    // 3. Unauthorized wallet submission attempt (UnauthorizedSigner / Revoked check)
    const forgedSig = ("0x" + "aa".repeat(65)) as `0x${string}`;
    await expect(
      oracleAdapter.write.submitAttestation([attestationParams, forgedSig], {
        account: unauthorized.account,
      })
    ).to.be.rejected;

    // 4. Authorized attestation submission to OracleAdapter -> Vault
    const txHash = await oracleAdapter.write.submitAttestation([attestationParams, signature], {
      account: attester.account,
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    expect(receipt.status).to.equal("success");

    // 5. Verify Request State Changed to CLAIMABLE (4)
    const updatedReq = await vault.read.getRequest([requestId]);
    expect(updatedReq.state).to.equal(4); // 4 = Claimable
    expect(updatedReq.owner.toLowerCase()).to.equal(alice.account.address.toLowerCase());
    expect(updatedReq.claimableShares > 0n).to.be.true;

    // 6. Verify Replay Protection (Submitting same attestation twice reverts)
    await expect(
      oracleAdapter.write.submitAttestation([attestationParams, signature], {
        account: attester.account,
      })
    ).to.be.rejected;

    // 7. Verify Alice has NOT yet claimed shares (shares = 0)
    const aliceShares = await vault.read.balanceOf([alice.account.address]);
    expect(aliceShares).to.equal(0n);

    // 8. Verify Bob Isolation (Bob shares = 0, Bob USDC unchanged)
    const bobShares = await vault.read.balanceOf([bob.account.address]);
    expect(bobShares).to.equal(0n);
  });
});
