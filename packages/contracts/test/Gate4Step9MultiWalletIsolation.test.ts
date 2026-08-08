import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";
import { keccak256, stringToBytes } from "viem";

describe("GATE 4.9 — Multi-Wallet Isolation & Accounting Integrity Validation Suite", function () {
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

  it("Verifies strict cross-wallet isolation between Alice (REQ-0001) and Bob (REQ-0002)", async function () {
    const { attester, alice, bob, publicClient, mockUSDC, oracleAdapter, vault } = await deployFixture();

    const depositAmount = 1000000000n; // 1000 USDC
    const chainId = await publicClient.getChainId();

    // 1. Alice creates Request #001
    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    await vault.write.requestDeposit([depositAmount], { account: alice.account });
    const req1Id = "REQ-0001";

    // 2. Bob creates Request #002
    await mockUSDC.write.approve([vault.address, depositAmount], { account: bob.account });
    await vault.write.requestDeposit([depositAmount], { account: bob.account });
    const req2Id = "REQ-0002";

    // 3. Verify Ownership & State Invariants
    const req1Info = await vault.read.getRequest([req1Id]);
    const req2Info = await vault.read.getRequest([req2Id]);

    expect(req1Info.owner.toLowerCase()).to.equal(alice.account.address.toLowerCase());
    expect(req2Info.owner.toLowerCase()).to.equal(bob.account.address.toLowerCase());
    expect(req1Info.owner.toLowerCase()).to.not.equal(bob.account.address.toLowerCase());

    // 4. Settle Alice's Request #001
    const currentBlock = await publicClient.getBlock();
    const passRisk = keccak256(stringToBytes("PASS"));
    const attestationParams = {
      assetId: "RWA-001",
      requestId: req1Id,
      state: "SETTLED",
      nav: 1002500n,
      yieldRate: 520n,
      riskStatus: passRisk,
      nonce: 2001n,
      timestamp: currentBlock.timestamp,
    };

    const signature = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      attestationParams
    );

    await oracleAdapter.write.submitAttestation([attestationParams, signature], {
      account: attester.account,
    });

    // 5. Bob attempts to claim Alice's shares -> Shares must be minted strictly to Alice, NOT Bob!
    await vault.write.claimShares([req1Id], { account: bob.account });

    const aliceShares = await vault.read.balanceOf([alice.account.address]);
    const bobShares = await vault.read.balanceOf([bob.account.address]);

    expect(aliceShares > 0n).to.be.true; // Alice received her shares
    expect(bobShares).to.equal(0n); // Bob received 0 shares from Alice's request!

    // 6. Verify Bob's Request #002 remains PENDING and unmutated
    const req2CurrentState = await vault.read.getRequest([req2Id]);
    expect(req2CurrentState.state === 0 || req2CurrentState.state === 1).to.be.true;
    expect(req2CurrentState.claimableShares).to.equal(0n);
  });
});
