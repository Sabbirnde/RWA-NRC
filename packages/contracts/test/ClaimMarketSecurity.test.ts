import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";
import { keccak256, stringToBytes } from "viem";

describe("Claim Market Security & T+0 Early Liquidity Suite", function () {
  async function deployFixture() {
    const [owner, attester, user1, user2, attacker] =
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

  it("1. Fake Claim Listing -> Reverts with ClaimNotFound", async function () {
    const { user1, claimMarket } = await deployFixture();

    await expect(
      claimMarket.simulate.listClaim([999n, 1000000n], { account: user1.account })
    ).to.be.rejectedWith("ClaimNotFound");
  });

  it("2. Non-Owner Listing Attempt -> Reverts with NotClaimOwner", async function () {
    const { user1, attacker, mockUSDC, vault, claimMarket } = await deployFixture();

    await mockUSDC.write.faucet([user1.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: user1.account });
    await vault.write.requestDeposit([1000000000n], { account: user1.account });

    // Attacker tries to list User1's claim
    await expect(
      claimMarket.simulate.listClaim([1n, 950000000n], { account: attacker.account })
    ).to.be.rejectedWith("NotClaimOwner");
  });

  it("3. Price Gouging (> Face Value) -> Reverts with InvalidPrice", async function () {
    const { user1, mockUSDC, vault, claimMarket } = await deployFixture();

    await mockUSDC.write.faucet([user1.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: user1.account });
    await vault.write.requestDeposit([1000000000n], { account: user1.account });

    // User1 tries to list $1000 face value claim for $2000
    await expect(
      claimMarket.simulate.listClaim([1n, 2000000000n], { account: user1.account })
    ).to.be.rejectedWith("InvalidPrice");
  });

  it("4. Zero Price Listing -> Reverts with InvalidPrice", async function () {
    const { user1, mockUSDC, vault, claimMarket } = await deployFixture();

    await mockUSDC.write.faucet([user1.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: user1.account });
    await vault.write.requestDeposit([1000000000n], { account: user1.account });

    await expect(
      claimMarket.simulate.listClaim([1n, 0n], { account: user1.account })
    ).to.be.rejectedWith("InvalidPrice");
  });

  it("5. Self-Buying Attempt -> Reverts with CannotBuySelf", async function () {
    const { user1, mockUSDC, vault, claimMarket } = await deployFixture();

    await mockUSDC.write.faucet([user1.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: user1.account });
    await vault.write.requestDeposit([1000000000n], { account: user1.account });

    await claimMarket.write.listClaim([1n, 950000000n], { account: user1.account });

    await expect(
      claimMarket.simulate.buyClaim([1n], { account: user1.account })
    ).to.be.rejectedWith("CannotBuySelf");
  });

  it("6. Purchasing Inactive / Cancelled Listing -> Reverts with ListingNotActive", async function () {
    const { user1, user2, mockUSDC, vault, claimMarket } = await deployFixture();

    await mockUSDC.write.faucet([user1.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: user1.account });
    await vault.write.requestDeposit([1000000000n], { account: user1.account });

    await claimMarket.write.listClaim([1n, 950000000n], { account: user1.account });
    await claimMarket.write.cancelListing([1n], { account: user1.account });

    await mockUSDC.write.faucet([user2.account.address, 1000000000n]);
    await mockUSDC.write.approve([claimMarket.address, 1000000000n], { account: user2.account });

    await expect(
      claimMarket.simulate.buyClaim([1n], { account: user2.account })
    ).to.be.rejectedWith("ListingNotActive");
  });

  it("7. Full End-to-End T+0 Early Liquidity & Settlement Payout Flow", async function () {
    const {
      attester,
      user1,
      user2,
      publicClient,
      mockUSDC,
      oracleAdapter,
      vault,
      claimRegistry,
      claimMarket,
    } = await deployFixture();

    // 1. User1 deposits 1,000 USDC into AsyncRWAVault (REQ-0001 created, Claim #1 minted)
    await mockUSDC.write.faucet([user1.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: user1.account });
    await vault.write.requestDeposit([1000000000n], { account: user1.account });

    // 2. User1 lists Claim #1 for 980 USDC (T+0 early liquidity at 2% discount)
    await claimMarket.write.listClaim([1n, 980000000n], { account: user1.account });

    // 3. User2 buys Claim #1 for 980 USDC
    await mockUSDC.write.faucet([user2.account.address, 980000000n]);
    await mockUSDC.write.approve([claimMarket.address, 980000000n], { account: user2.account });
    await claimMarket.write.buyClaim([1n], { account: user2.account });

    // Verify User1 received 980 USDC T+0 cash immediately
    const user1Balance = await mockUSDC.read.balanceOf([user1.account.address]);
    expect(user1Balance).to.equal(980000000n);

    // Verify User2 owns Claim #1 in ClaimRegistry
    const claimOwner = await claimRegistry.read.getClaimOwner([1n]);
    expect(claimOwner.toLowerCase()).to.equal(user2.account.address.toLowerCase());

    // 4. Off-chain Middleware attests RWA state and OracleAdapter settles attestation
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

    const signature = await getEIP712AttestationSignature(
      attester,
      oracleAdapter.address,
      chainId,
      params
    );

    await oracleAdapter.write.submitAttestation([params, signature]);

    // 5. User2 claims shares from AsyncRWAVault
    await vault.write.claimShares(["REQ-0001"], { account: user2.account });

    // Invariant Proof: User2 received 1,000 vRWA shares (18 decimals) as claim owner
    const user2Shares = await vault.read.balanceOf([user2.account.address]);
    expect(user2Shares).to.equal(1000000000000000000000n); // 1000 * 10^18
  });
});
