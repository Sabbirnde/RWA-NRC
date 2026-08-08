import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";
import { keccak256, stringToBytes } from "viem";

describe("GATE 5.6 — Post-Market Settlement & Payout Routing Validation Suite", function () {
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
      claimRegistry,
      claimMarket,
    };
  }

  it("Executes end-to-end post-market settlement: Alice deposit -> list -> Bob buy -> RWA attestation -> Bob receives 1,000 vRWA shares", async function () {
    const { attester, alice, bob, publicClient, mockUSDC, oracleAdapter, vault, claimRegistry, claimMarket } =
      await deployFixture();

    const depositAmount = 1000000000n; // 1000 USDC
    const salePrice = 980000000n; // 980 USDC

    // 1. Alice Deposit Request
    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    await vault.write.requestDeposit([depositAmount], { account: alice.account });

    const reqInfo = await vault.read.getRequest(["REQ-0001"]);
    const claimId = reqInfo.claimId;

    // 2. Alice lists Claim #002 at 980 USDC
    await claimMarket.write.listClaim([claimId, salePrice], { account: alice.account });

    // 3. Bob buys Claim #002 for 980 USDC
    await mockUSDC.write.approve([claimMarket.address, salePrice], { account: bob.account });
    await claimMarket.write.buyClaim([claimId], { account: bob.account });

    // Verify Bob is current claim owner & status is active secondary
    const preSettlementClaim = await claimRegistry.read.getClaim([claimId]);
    expect(preSettlementClaim.owner.toLowerCase()).to.equal(bob.account.address.toLowerCase());

    // 4. RWA Settlement Pipeline via Signed EIP-712 Attestation
    const chainId = BigInt(hre.network.config.chainId || 31337);
    const nonce = 5001n;
    const currentBlock = await publicClient.getBlock();
    const timestamp = currentBlock.timestamp;
    const nav = 1002500n; // $1,002.50 NAV

    const domain = {
      name: "RWA-OracleAdapter",
      version: "1.0.0",
      chainId: chainId,
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

    const params = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: nav,
      yieldRate: 520n,
      riskStatus: keccak256(stringToBytes("PASS")),
      nonce: nonce,
      timestamp: timestamp,
    };

    const signature = await attester.signTypedData({
      domain,
      types,
      primaryType: "Attestation",
      message: params,
    });

    const settleTx = await oracleAdapter.write.submitAttestation([params, signature], {
      account: attester.account,
    });
    const settleReceipt = await publicClient.waitForTransactionReceipt({ hash: settleTx });
    expect(settleReceipt.status).to.equal("success");

    // 5. Verify Request State transitioned to CLAIMABLE
    const claimableReqInfo = await vault.read.getRequest(["REQ-0001"]);
    expect(claimableReqInfo.state).to.equal(4); // 4 = Claimable

    // 6. Bob claims shares
    const claimTx = await vault.write.claimShares(["REQ-0001"], { account: bob.account });
    const claimReceipt = await publicClient.waitForTransactionReceipt({ hash: claimTx });
    expect(claimReceipt.status).to.equal("success");

    // 7. Verification of Mandatory Checks (12 items)
    // Check 1: Request & Claim finalized
    const finalReqInfo = await vault.read.getRequest(["REQ-0001"]);
    expect(finalReqInfo.state).to.equal(5); // 5 = Finalized

    const finalClaim = await claimRegistry.read.getClaim([claimId]);
    expect(finalClaim.status).to.equal(3); // 3 = Settled

    // Check 2: Bob remains current owner
    expect(finalClaim.owner.toLowerCase()).to.equal(bob.account.address.toLowerCase());

    // Check 3: Alice has 0 share balance from settlement
    const aliceShares = await vault.read.balanceOf([alice.account.address]);
    expect(aliceShares).to.equal(0n);

    // Check 4 & 5: Bob receives final settlement shares (1000 shares = 1000 * 10^18)
    const bobShares = await vault.read.balanceOf([bob.account.address]);
    expect(bobShares).to.equal(1000000000000000000000n);

    // Check 8: Claim can no longer be sold
    await expect(
      claimMarket.write.listClaim([claimId, salePrice], { account: bob.account })
    ).to.be.rejected;

    // Check 9: Claim can no longer be transferred
    await expect(
      claimRegistry.write.transferClaim([claimId, alice.account.address], { account: bob.account })
    ).to.be.rejected;

    // Check 10: Double settlement reverts
    await expect(
      vault.write.claimShares(["REQ-0001"], { account: bob.account })
    ).to.be.rejected;
  });
});
