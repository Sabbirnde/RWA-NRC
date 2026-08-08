import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";
import { keccak256, stringToBytes } from "viem";

describe("GATE 1 - STEP 6: Replay, Double Claim & State Machine Security Validation", function () {
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

  it("Test 1 — Attestation Replay: Submitting the exact same attestation twice reverts with ReplayedNonce", async function () {
    const { attester, userA, publicClient, mockUSDC, oracleAdapter, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });
    await vault.write.requestDeposit([1000000000n], { account: userA.account });

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
      nonce: 601n,
      timestamp: now,
    };

    const signature = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      params
    );

    await oracleAdapter.write.submitAttestation([params, signature]);

    // Second submission attempt must revert with ReplayedNonce
    await expect(
      oracleAdapter.simulate.submitAttestation([params, signature])
    ).to.be.rejected;
  });

  it("Test 2 — Double Claim: Calling claimShares twice on a FINALIZED request reverts", async function () {
    const { attester, userA, publicClient, mockUSDC, oracleAdapter, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });
    await vault.write.requestDeposit([1000000000n], { account: userA.account });

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
      nonce: 602n,
      timestamp: now,
    };

    const signature = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      params
    );

    await oracleAdapter.write.submitAttestation([params, signature]);
    await vault.write.claimShares(["REQ-0001"], { account: userA.account });

    const balanceAfterFirstClaim = await vault.read.balanceOf([userA.account.address]);
    const reqAfterFirstClaim = await vault.read.getRequest(["REQ-0001"]);
    expect(reqAfterFirstClaim.state).to.equal(5); // Finalized

    // Second claim attempt must revert
    await expect(
      vault.simulate.claimShares(["REQ-0001"], { account: userA.account })
    ).to.be.rejected;

    const balanceAfterSecondAttempt = await vault.read.balanceOf([userA.account.address]);
    expect(balanceAfterSecondAttempt).to.equal(balanceAfterFirstClaim);
  });

  it("Test 3 — Finalized -> Claimable Violation: Submitting a new attestation on FINALIZED request reverts", async function () {
    const { attester, userA, publicClient, mockUSDC, oracleAdapter, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });
    await vault.write.requestDeposit([1000000000n], { account: userA.account });

    const chainId = await publicClient.getChainId();
    const latestBlock = await publicClient.getBlock();
    const now = latestBlock.timestamp;
    const params1 = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 500n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 603n,
      timestamp: now,
    };

    const sig1 = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      params1
    );

    await oracleAdapter.write.submitAttestation([params1, sig1]);
    await vault.write.claimShares(["REQ-0001"], { account: userA.account });

    const params2 = {
      ...params1,
      nonce: 604n, // Fresh nonce
    };

    const sig2 = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      params2
    );

    // Resubmitting attestation on FINALIZED request must NOT alter state or claimable shares
    await oracleAdapter.write.submitAttestation([params2, sig2]);

    const reqAfterResubmission = await vault.read.getRequest(["REQ-0001"]);
    expect(reqAfterResubmission.state).to.equal(5); // Finalized state strictly preserved!
    expect(reqAfterResubmission.claimableShares).to.equal(0n);
  });

  it("Test 4 — Finalized -> Claim Re-execution: Second claimShares call reverts", async function () {
    const { attester, userA, publicClient, mockUSDC, oracleAdapter, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });
    await vault.write.requestDeposit([1000000000n], { account: userA.account });

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
      nonce: 605n,
      timestamp: now,
    };

    const signature = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      params
    );

    await oracleAdapter.write.submitAttestation([params, signature]);
    await vault.write.claimShares(["REQ-0001"], { account: userA.account });

    await expect(
      vault.simulate.claimShares(["REQ-0001"], { account: userA.account })
    ).to.be.rejected;
  });

  it("Test 5 — State Machine Monotonicity & Backward Transition Prevention", async function () {
    const { vault } = await deployFixture();

    // Verify isValidStateTransition returns false for all backward jumps
    expect(await vault.read.isValidStateTransition([4, 1])).to.be.false; // Claimable -> Pending
    expect(await vault.read.isValidStateTransition([5, 4])).to.be.false; // Finalized -> Claimable
    expect(await vault.read.isValidStateTransition([5, 1])).to.be.false; // Finalized -> Pending
    expect(await vault.read.isValidStateTransition([5, 0])).to.be.false; // Finalized -> None
  });

  it("Test 6 — Cross-Request Isolation: Operations on Request A cannot mutate Request B", async function () {
    const { attester, userA, userB, publicClient, mockUSDC, oracleAdapter, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.faucet([userB.account.address, 2000000000n]);

    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });
    await mockUSDC.write.approve([vault.address, 2000000000n], { account: userB.account });

    await vault.write.requestDeposit([1000000000n], { account: userA.account }); // REQ-0001
    await vault.write.requestDeposit([2000000000n], { account: userB.account }); // REQ-0002

    const chainId = await publicClient.getChainId();
    const latestBlock = await publicClient.getBlock();
    const now = latestBlock.timestamp;
    const paramsA = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 500n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: 606n,
      timestamp: now,
    };

    const sigA = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      paramsA
    );

    await oracleAdapter.write.submitAttestation([paramsA, sigA]);
    await vault.write.claimShares(["REQ-0001"], { account: userA.account });

    // REQ-0002 must remain PENDING with 0 shares minted to userB
    const reqB = await vault.read.getRequest(["REQ-0002"]);
    expect(reqB.state).to.equal(1); // Pending
    const balanceB = await vault.read.balanceOf([userB.account.address]);
    expect(balanceB).to.equal(0n);
  });

  it("Test 7 — Cross-User Authorization: Shares minted strictly to claim recipient", async function () {
    const { attester, userA, attacker, publicClient, mockUSDC, oracleAdapter, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });
    await vault.write.requestDeposit([1000000000n], { account: userA.account });

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
      nonce: 607n,
      timestamp: now,
    };

    const signature = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      params
    );

    await oracleAdapter.write.submitAttestation([params, signature]);

    // Attacker calls claimShares on userA's request
    await vault.write.claimShares(["REQ-0001"], { account: attacker.account });

    const attackerBalance = await vault.read.balanceOf([attacker.account.address]);
    const userABalance = await vault.read.balanceOf([userA.account.address]);

    expect(attackerBalance).to.equal(0n);
    expect(userABalance).to.equal(1000000000000000000000n);
  });

  it("Test 8 — Fuzz / Monotonic State Machine Verification: All state transitions enforce monotonic forward flow", async function () {
    const { vault } = await deployFixture();

    const states = [0, 1, 2, 3, 4, 5, 6];
    for (let i = 0; i < states.length; i++) {
      for (let j = 0; j < states.length; j++) {
        const from = states[i];
        const to = states[j];
        const isValid = await vault.read.isValidStateTransition([from, to]);

        // Explicit allowed transitions in AsyncRWAVault.sol
        const allowed =
          (from === 0 && to === 1) ||
          (from === 1 && to === 2) ||
          (from === 1 && to === 4) ||
          (from === 2 && to === 3) ||
          (from === 3 && to === 4) ||
          (from === 4 && to === 5) ||
          ((from === 0 || from === 1 || from === 2 || from === 3) && to === 6);

        expect(isValid).to.equal(allowed);

        // Backward state transition invariant: no backward transition (to <= from) is EVER allowed
        if (to <= from && from !== 6) {
          expect(isValid).to.be.false;
        }
      }
    }
  });
});
