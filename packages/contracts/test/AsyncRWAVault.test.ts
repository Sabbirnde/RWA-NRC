import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";
import { keccak256, stringToBytes } from "viem";

describe("AsyncRWAVault & Protocol Ecosystem Security Suite", function () {
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
      unauthorizedSigner,
      publicClient,
      mockUSDC,
      assetRegistry,
      oracleAdapter,
      claimRegistry,
      vault,
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

  describe("1. Premature Minting Protection & Asynchronous Lifecycle", function () {
    it("Should prevent share minting while request is PENDING", async function () {
      const { user1, mockUSDC, vault } = await deployFixture();

      await mockUSDC.write.faucet([user1.account.address, 1000000000n]);
      await mockUSDC.write.approve([vault.address, 1000000000n], {
        account: user1.account,
      });

      await vault.write.requestDeposit([1000000000n], {
        account: user1.account,
      });

      // Invariant: User share balance must be 0 prior to attestation settlement
      const userShares = await vault.read.balanceOf([user1.account.address]);
      expect(userShares).to.equal(0n);

      const req = (await vault.read.getRequest(["REQ-0001"])) as any;
      expect(req.claimableShares).to.equal(0n);
      expect(req.state).to.equal(1); // Pending

      // Premature claim attempt must revert
      await expect(
        vault.simulate.claimShares(["REQ-0001"], { account: user1.account })
      ).to.be.rejected;
    });

    it("Should finalize deposit and mint shares after valid attestation", async function () {
      const {
        attester,
        user1,
        publicClient,
        mockUSDC,
        oracleAdapter,
        vault,
      } = await deployFixture();

      await mockUSDC.write.faucet([user1.account.address, 1000000000n]);
      await mockUSDC.write.approve([vault.address, 1000000000n], {
        account: user1.account,
      });
      await vault.write.requestDeposit([1000000000n], {
        account: user1.account,
      });

      const chainId = await publicClient.getChainId();
      const now = BigInt(Math.floor(Date.now() / 1000));
      const params = {
        assetId: "RWA-001",
        requestId: "REQ-0001",
        state: "SETTLED",
        nav: 1002500n,
        yieldRate: 520n,
        riskStatus: keccak256(stringToBytes("PASS")),
        nonce: 1n,
        timestamp: now,
      };

      const sig = await getEIP712AttestationSignature(
        attester,
        oracleAdapter.address,
        chainId,
        params
      );

      await oracleAdapter.write.submitAttestation([params, sig]);

      const req = (await vault.read.getRequest(["REQ-0001"])) as any;
      expect(req.state).to.equal(4); // Claimable
      expect(req.claimableShares > 0n).to.be.true;

      await vault.write.claimShares(["REQ-0001"], { account: user1.account });

      const finalShares = await vault.read.balanceOf([user1.account.address]);
      expect(finalShares).to.equal(1000000000000000000000n);
    });
  });

  describe("2. Oracle & EIP-712 Attestation Security", function () {
    it("Should reject attestations signed by unauthorized signers", async function () {
      const {
        unauthorizedSigner,
        user1,
        publicClient,
        mockUSDC,
        oracleAdapter,
        vault,
      } = await deployFixture();

      await mockUSDC.write.faucet([user1.account.address, 1000000000n]);
      await mockUSDC.write.approve([vault.address, 1000000000n], {
        account: user1.account,
      });
      await vault.write.requestDeposit([1000000000n], {
        account: user1.account,
      });

      const chainId = await publicClient.getChainId();
      const now = BigInt(Math.floor(Date.now() / 1000));
      const params = {
        assetId: "RWA-001",
        requestId: "REQ-0001",
        state: "SETTLED",
        nav: 1002500n,
        yieldRate: 520n,
        riskStatus: keccak256(stringToBytes("PASS")),
        nonce: 2n,
        timestamp: now,
      };

      const invalidSig = await getEIP712AttestationSignature(
        unauthorizedSigner,
        oracleAdapter.address,
        chainId,
        params
      );

      await expect(
        oracleAdapter.write.submitAttestation([params, invalidSig])
      ).to.be.rejected;
    });

    it("Should prevent attestation replay attacks via nonce tracking", async function () {
      const {
        attester,
        user1,
        publicClient,
        mockUSDC,
        oracleAdapter,
        vault,
      } = await deployFixture();

      await mockUSDC.write.faucet([user1.account.address, 1000000000n]);
      await mockUSDC.write.approve([vault.address, 1000000000n], {
        account: user1.account,
      });
      await vault.write.requestDeposit([1000000000n], {
        account: user1.account,
      });

      const chainId = await publicClient.getChainId();
      const now = BigInt(Math.floor(Date.now() / 1000));
      const params = {
        assetId: "RWA-001",
        requestId: "REQ-0001",
        state: "SETTLED",
        nav: 1002500n,
        yieldRate: 520n,
        riskStatus: keccak256(stringToBytes("PASS")),
        nonce: 10n,
        timestamp: now,
      };

      const sig = await getEIP712AttestationSignature(
        attester,
        oracleAdapter.address,
        chainId,
        params
      );

      await oracleAdapter.write.submitAttestation([params, sig]);

      // Replay attempt must revert with ReplayedNonce
      await expect(
        oracleAdapter.write.submitAttestation([params, sig])
      ).to.be.rejected;
    });

    it("Should reject stale attestations exceeding MAX_DATA_AGE", async function () {
      const {
        attester,
        user1,
        publicClient,
        mockUSDC,
        oracleAdapter,
        vault,
      } = await deployFixture();

      await mockUSDC.write.faucet([user1.account.address, 1000000000n]);
      await mockUSDC.write.approve([vault.address, 1000000000n], {
        account: user1.account,
      });
      await vault.write.requestDeposit([1000000000n], {
        account: user1.account,
      });

      const chainId = await publicClient.getChainId();
      // Timestamp 30 minutes in the past (> 15m maxDataAge)
      const staleTimestamp = BigInt(Math.floor(Date.now() / 1000) - 1800);
      const params = {
        assetId: "RWA-001",
        requestId: "REQ-0001",
        state: "SETTLED",
        nav: 1002500n,
        yieldRate: 520n,
        riskStatus: keccak256(stringToBytes("PASS")),
        nonce: 20n,
        timestamp: staleTimestamp,
      };

      const sig = await getEIP712AttestationSignature(
        attester,
        oracleAdapter.address,
        chainId,
        params
      );

      await expect(
        oracleAdapter.write.submitAttestation([params, sig])
      ).to.be.rejected;
    });
  });

  describe("3. Fixed-Price P2P Claim Marketplace & T+0 Liquidity", function () {
    it("Should allow user1 to list pending claim and user2 to purchase for T+0 liquidity", async function () {
      const {
        attester,
        user1,
        user2,
        publicClient,
        mockUSDC,
        oracleAdapter,
        vault,
        claimMarket,
        claimRegistry,
      } = await deployFixture();

      // User1 submits deposit request for 1,000 USDC -> receives Claim #1
      await mockUSDC.write.faucet([user1.account.address, 1000000000n]);
      await mockUSDC.write.approve([vault.address, 1000000000n], {
        account: user1.account,
      });
      await vault.write.requestDeposit([1000000000n], {
        account: user1.account,
      });

      // User1 lists Claim #1 for 980 USDC (2% discount for T+0 liquidity)
      await claimMarket.write.listClaim([1n, 980000000n], {
        account: user1.account,
      });

      // User2 funds 980 USDC and buys Claim #1
      await mockUSDC.write.faucet([user2.account.address, 980000000n]);
      await mockUSDC.write.approve([claimMarket.address, 980000000n], {
        account: user2.account,
      });
      await claimMarket.write.buyClaim([1n], { account: user2.account });

      // Check ownership transfer: Claim #1 now belongs to User2
      const claimOwner = await claimRegistry.read.getClaimOwner([1n]);
      expect(claimOwner.toLowerCase()).to.equal(
        user2.account.address.toLowerCase()
      );

      // User1 received 980 USDC (T+0 liquidity)
      const user1Balance = await mockUSDC.read.balanceOf([
        user1.account.address,
      ]);
      expect(user1Balance).to.equal(980000000n);

      // Now off-chain settlement completes -> valid attestation submitted
      const chainId = await publicClient.getChainId();
      const now = BigInt(Math.floor(Date.now() / 1000));
      const params = {
        assetId: "RWA-001",
        requestId: "REQ-0001",
        state: "SETTLED",
        nav: 1002500n,
        yieldRate: 520n,
        riskStatus: keccak256(stringToBytes("PASS")),
        nonce: 30n,
        timestamp: now,
      };
      const sig = await getEIP712AttestationSignature(
        attester,
        oracleAdapter.address,
        chainId,
        params
      );
      await oracleAdapter.write.submitAttestation([params, sig]);

      // User2 (the new claim owner) claims the final vault shares!
      await vault.write.claimShares(["REQ-0001"], { account: user2.account });

      const user2Shares = await vault.read.balanceOf([user2.account.address]);
      expect(user2Shares).to.equal(1000000000000000000000n);
    });
  });

  describe("4. State Machine Transition Integrity", function () {
    it("Should revert Pending -> Finalized transition with RequestNotClaimable error", async function () {
      const { user1, mockUSDC, vault } = await deployFixture();

      await mockUSDC.write.faucet([user1.account.address, 1000000000n]);
      await mockUSDC.write.approve([vault.address, 1000000000n], {
        account: user1.account,
      });
      await vault.write.requestDeposit([1000000000n], {
        account: user1.account,
      });

      // Direct Pending -> Finalized transition attempt via claimShares must fail
      await expect(
        vault.simulate.claimShares(["REQ-0001"], { account: user1.account })
      ).to.be.rejectedWith("RequestNotClaimable");
    });

    it("Should revert double claim attempt on Finalized request", async function () {
      const {
        attester,
        user1,
        publicClient,
        mockUSDC,
        oracleAdapter,
        vault,
      } = await deployFixture();

      await mockUSDC.write.faucet([user1.account.address, 1000000000n]);
      await mockUSDC.write.approve([vault.address, 1000000000n], {
        account: user1.account,
      });
      await vault.write.requestDeposit([1000000000n], {
        account: user1.account,
      });

      const chainId = await publicClient.getChainId();
      const now = BigInt(Math.floor(Date.now() / 1000));
      const params = {
        assetId: "RWA-001",
        requestId: "REQ-0001",
        state: "SETTLED",
        nav: 1002500n,
        yieldRate: 520n,
        riskStatus: keccak256(stringToBytes("PASS")),
        nonce: 40n,
        timestamp: now,
      };

      const sig = await getEIP712AttestationSignature(
        attester,
        oracleAdapter.address,
        chainId,
        params
      );

      await oracleAdapter.write.submitAttestation([params, sig]);
      await vault.write.claimShares(["REQ-0001"], { account: user1.account });

      // Second claim attempt must revert
      await expect(
        vault.simulate.claimShares(["REQ-0001"], { account: user1.account })
      ).to.be.rejectedWith("RequestNotClaimable");
    });

    it("Should prevent Finalized -> Claimable transition if attestation is resubmitted", async function () {
      const {
        attester,
        user1,
        publicClient,
        mockUSDC,
        oracleAdapter,
        vault,
      } = await deployFixture();

      await mockUSDC.write.faucet([user1.account.address, 1000000000n]);
      await mockUSDC.write.approve([vault.address, 1000000000n], {
        account: user1.account,
      });
      await vault.write.requestDeposit([1000000000n], {
        account: user1.account,
      });

      const chainId = await publicClient.getChainId();
      const now = BigInt(Math.floor(Date.now() / 1000));
      const params1 = {
        assetId: "RWA-001",
        requestId: "REQ-0001",
        state: "SETTLED",
        nav: 1002500n,
        yieldRate: 520n,
        riskStatus: keccak256(stringToBytes("PASS")),
        nonce: 50n,
        timestamp: now,
      };

      const sig1 = await getEIP712AttestationSignature(
        attester,
        oracleAdapter.address,
        chainId,
        params1
      );

      // 1. Submit attestation & claim shares -> request becomes Finalized (state = 5)
      await oracleAdapter.write.submitAttestation([params1, sig1]);
      await vault.write.claimShares(["REQ-0001"], { account: user1.account });

      let req = (await vault.read.getRequest(["REQ-0001"])) as any;
      expect(req.state).to.equal(5); // Finalized

      // 2. Resubmit attestation with a fresh nonce targeting same request
      const params2 = { ...params1, nonce: 51n };
      const sig2 = await getEIP712AttestationSignature(
        attester,
        oracleAdapter.address,
        chainId,
        params2
      );

      await oracleAdapter.write.submitAttestation([params2, sig2]);

      // State MUST remain Finalized (5) and NOT revert back to Claimable (4)
      req = (await vault.read.getRequest(["REQ-0001"])) as any;
      expect(req.state).to.equal(5); // Finalized
    });
  });
});
