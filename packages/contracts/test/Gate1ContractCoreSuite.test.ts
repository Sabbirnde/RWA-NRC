import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 1 — Smart Contract Core Exhaustive Validation Suite", function () {
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

  describe("1. ERC-7540 Async Deposit & Zero Immediate Settlement Verification", function () {
    it("Alice deposits 1000 USDC -> Request REQ-0001 created in PENDING state with 0 shares minted", async function () {
      const { alice, publicClient, mockUSDC, vault } = await deployFixture();
      const depositAmount = 1000000000n; // 1000 USDC

      await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
      const depositTx = await vault.write.requestDeposit([depositAmount], { account: alice.account });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: depositTx });

      const req = await vault.read.getRequest(["REQ-0001"]);
      const aliceShares = await vault.read.balanceOf([alice.account.address]);
      const vaultUsdcBalance = await mockUSDC.read.balanceOf([vault.address]);

      expect(receipt.status).to.equal("success");
      expect(req.requestId).to.equal("REQ-0001");
      expect(req.state).to.equal(1); // RequestState.Pending
      expect(req.amount).to.equal(depositAmount);
      expect(req.claimableShares).to.equal(0n);
      expect(aliceShares).to.equal(0n); // ZERO SHARES MINTED IMMEDIATELY!
      expect(vaultUsdcBalance).to.equal(depositAmount);
    });
  });

  describe("2. Async Redeem Verification", function () {
    it("Alice requests redemption -> Request REQ-0002 created in PENDING state with 0 USDC returned immediately", async function () {
      const { attester, alice, publicClient, mockUSDC, oracleAdapter, vault, domain, types } = await deployFixture();
      const depositAmount = 1000000000n; // 1000 USDC

      // Deposit and settle REQ-0001 first so Alice gets shares
      await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
      await vault.write.requestDeposit([depositAmount], { account: alice.account });

      const timestamp = BigInt(Math.floor(Date.now() / 1000));
      const value = {
        assetId: "RWA-001",
        requestId: "REQ-0001",
        state: "SETTLED",
        nav: 1000000n,
        yieldRate: 520n,
        riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
        nonce: 1001n,
        timestamp,
      };
      const signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });
      await oracleAdapter.write.submitAttestation([value, signature]);
      await vault.write.claimShares(["REQ-0001"], { account: alice.account });

      const aliceSharesBeforeRedeem = await vault.read.balanceOf([alice.account.address]);
      expect(aliceSharesBeforeRedeem).to.equal(1000000000000000000000n); // 1,000 vRWA shares

      // Execute requestRedeem(500 vRWA)
      const redeemAmount = 500000000000000000000n;
      const aliceUsdcBeforeRedeem = await mockUSDC.read.balanceOf([alice.account.address]);

      const redeemTx = await vault.write.requestRedeem([redeemAmount], { account: alice.account });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: redeemTx });

      const req2 = await vault.read.getRequest(["REQ-0002"]);
      const aliceUsdcAfterRedeem = await mockUSDC.read.balanceOf([alice.account.address]);

      expect(receipt.status).to.equal("success");
      expect(req2.requestId).to.equal("REQ-0002");
      expect(req2.state).to.equal(1); // RequestState.Pending
      expect(req2.claimableAssets).to.equal(0n);
      expect(aliceUsdcAfterRedeem).to.equal(aliceUsdcBeforeRedeem); // ZERO USDC RETURNED IMMEDIATELY!
    });
  });

  describe("3. Invalid State Transition Enforcement & Boundary Protection", function () {
    it("PENDING -> SETTLED without authorization -> Reverts with UnauthorizedOracle", async function () {
      const { alice, vault } = await deployFixture();
      await vault.write.requestDeposit([1000000000n], { account: alice.account });

      await expect(
        vault.write.onAttestationSettled(["REQ-0001", 1000000n], { account: alice.account })
      ).to.be.rejectedWith("UnauthorizedOracle");
    });

    it("PENDING -> CLAIMABLE without fulfillment -> Reverts with RequestNotClaimable", async function () {
      const { alice, vault } = await deployFixture();
      await vault.write.requestDeposit([1000000000n], { account: alice.account });

      await expect(
        vault.write.claimShares(["REQ-0001"], { account: alice.account })
      ).to.be.rejectedWith("RequestNotClaimable");
    });

    it("SETTLED -> PENDING transition is rejected by state machine", async function () {
      const { vault } = await deployFixture();
      // isValidStateTransition(Settled = 3, Pending = 1) MUST BE FALSE
      const isValid = await vault.read.isValidStateTransition([3, 1]);
      expect(isValid).to.equal(false);
    });

    it("Unknown request ID -> SETTLED / CLAIMABLE reverts with RequestNotClaimable", async function () {
      const { alice, vault } = await deployFixture();
      await expect(
        vault.write.claimShares(["REQ-9999"], { account: alice.account })
      ).to.be.rejectedWith("RequestNotClaimable");
    });
  });

  describe("4. Accounting Invariants, Events & Access Control", function () {
    it("Enforces emergency pause access control by owner", async function () {
      const { deployer, alice, mockUSDC, vault } = await deployFixture();
      await vault.write.pause({ account: deployer.account });

      await mockUSDC.write.approve([vault.address, 1000000000n], { account: alice.account });
      await expect(
        vault.write.requestDeposit([1000000000n], { account: alice.account })
      ).to.be.rejectedWith("EnforcedPause");
    });
  });
});
