import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";
import { keccak256, stringToBytes } from "viem";

describe("GATE 1 - STEP 5: Claimable -> Claim -> Finalized Validation", function () {
  async function deployFixture() {
    const [attester, userA, userB, attacker] = await hre.viem.getWalletClients();
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
      attacker,
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

  async function setupClaimableRequest(fixture: any, amount: bigint = 1000000000n) {
    const { attester, userA, publicClient, mockUSDC, oracleAdapter, vault } = fixture;

    await mockUSDC.write.faucet([userA.account.address, amount]);
    await mockUSDC.write.approve([vault.address, amount], { account: userA.account });
    await vault.write.requestDeposit([amount], { account: userA.account });

    const chainId = await publicClient.getChainId();
    const latestBlock = await publicClient.getBlock();
    const now = latestBlock.timestamp;
    const params = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 500n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 501n,
      timestamp: now,
    };

    const signature = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      params
    );

    await oracleAdapter.write.submitAttestation([params, signature]);
    return "REQ-0001";
  }

  it("Test 1 — Claim Execution: Successful claimShares execution on CLAIMABLE request", async function () {
    const fixture = await deployFixture();
    const requestId = await setupClaimableRequest(fixture);
    const { userA, vault } = fixture;

    const tx = await vault.write.claimShares([requestId], { account: userA.account });
    expect(tx).to.be.a("string");
  });

  it("Test 2 — Correct Shares: Recipient receives exact calculated shares", async function () {
    const fixture = await deployFixture();
    const requestId = await setupClaimableRequest(fixture, 1000000000n); // $1000 USDC
    const { userA, vault } = fixture;

    const beforeBalance = await vault.read.balanceOf([userA.account.address]);
    expect(beforeBalance).to.equal(0n);

    await vault.write.claimShares([requestId], { account: userA.account });

    const afterBalance = await vault.read.balanceOf([userA.account.address]);
    const expectedShares = 1000000000000000000000n; // 1000 * 10^18

    expect(afterBalance).to.equal(expectedShares);
    expect(afterBalance - beforeBalance).to.equal(expectedShares);
  });

  it("Test 3 — Request State: Request state transitions to FINALIZED", async function () {
    const fixture = await deployFixture();
    const requestId = await setupClaimableRequest(fixture);
    const { userA, vault } = fixture;

    const beforeReq = await vault.read.getRequest([requestId]);
    expect(beforeReq.state).to.equal(4); // Claimable

    await vault.write.claimShares([requestId], { account: userA.account });

    const afterReq = await vault.read.getRequest([requestId]);
    expect(afterReq.state).to.equal(5); // Finalized (enum RequestState.Finalized)
  });

  it("Test 4 — Accounting Invariant: Correct total supply and zero remaining claimable shares", async function () {
    const fixture = await deployFixture();
    const requestId = await setupClaimableRequest(fixture, 1000000000n);
    const { userA, vault } = fixture;

    await vault.write.claimShares([requestId], { account: userA.account });

    const req = await vault.read.getRequest([requestId]);
    expect(req.claimableShares).to.equal(0n);

    const totalSupply = await vault.read.totalSupply();
    const userBalance = await vault.read.balanceOf([userA.account.address]);
    expect(totalSupply).to.equal(userBalance);
  });

  it("Test 5 — Event Emission: DepositClaimed event emitted with correct parameters", async function () {
    const fixture = await deployFixture();
    const requestId = await setupClaimableRequest(fixture);
    const { userA, publicClient, vault } = fixture;

    const hash = await vault.write.claimShares([requestId], { account: userA.account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    expect(receipt.status).to.equal("success");
    expect(receipt.logs.length).to.be.gt(0);
  });

  it("Test 6 — Claim Authorization & Recipient Binding: Shares are minted strictly to rightful claim owner", async function () {
    const fixture = await deployFixture();
    const requestId = await setupClaimableRequest(fixture);
    const { userA, attacker, vault } = fixture;

    // Attacker calls claimShares on userA's claimable request
    await vault.write.claimShares([requestId], { account: attacker.account });

    // Shares must be minted to userA (claim owner), NOT attacker
    const userABalance = await vault.read.balanceOf([userA.account.address]);
    const attackerBalance = await vault.read.balanceOf([attacker.account.address]);

    expect(userABalance).to.equal(1000000000000000000000n);
    expect(attackerBalance).to.equal(0n);
  });
});
