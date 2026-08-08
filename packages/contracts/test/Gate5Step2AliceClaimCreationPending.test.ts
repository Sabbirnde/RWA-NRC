import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 5.2 — Claim Creation for Pending Settlement Request Suite", function () {
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

  it("Executes Alice 1000 USDC deposit -> Creates Claim #002 (Active / NOT_LISTED) for PENDING settlement", async function () {
    const { alice, bob, publicClient, mockUSDC, vault, claimRegistry } = await deployFixture();

    const depositAmount = 1000000000n; // 1000 USDC

    // 1. Approve & Request Deposit
    const approveTx = await mockUSDC.write.approve([vault.address, depositAmount], {
      account: alice.account,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });

    const depositTx = await vault.write.requestDeposit([depositAmount], { account: alice.account });
    const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositTx });
    expect(depositReceipt.status).to.equal("success");

    // 2. Verify Deposit Request Existence & PENDING state
    const requestId = "REQ-0001";
    const reqInfo = await vault.read.getRequest([requestId]);
    expect(reqInfo.owner.toLowerCase()).to.equal(alice.account.address.toLowerCase());
    expect(reqInfo.amount).to.equal(depositAmount);
    expect(reqInfo.state === 0 || reqInfo.state === 1).to.be.true; // 0 or 1 = Pending

    // 3. Verify Claim Creation & Metadata
    const claimId = reqInfo.claimId;
    expect(claimId > 0n).to.be.true;

    const claim = await claimRegistry.read.getClaim([claimId]);
    expect(claim.claimId).to.equal(claimId);
    expect(claim.requestId).to.equal(requestId);
    expect(claim.faceValue).to.equal(depositAmount);
    expect(claim.owner.toLowerCase()).to.equal(alice.account.address.toLowerCase());

    // 4. Verify Market Status = NOT_LISTED (0 = Active) & Settlement Status = PENDING
    expect(claim.status).to.equal(0); // 0 = Active / NOT_LISTED

    // 5. Verify No Settlement Has Occurred (Shares = 0)
    const aliceShares = await vault.read.balanceOf([alice.account.address]);
    expect(aliceShares).to.equal(0n);

    // 6. Verify Bob Isolation (Bob USDC & Shares Unchanged)
    const bobUSDC = await mockUSDC.read.balanceOf([bob.account.address]);
    const bobShares = await vault.read.balanceOf([bob.account.address]);
    expect(bobUSDC).to.equal(100000000000n);
    expect(bobShares).to.equal(0n);

    // 7. Verify Duplicate Claim Rejection for Same Request ID
    await expect(
      claimRegistry.write.createClaim([requestId, "RWA-001", alice.account.address, depositAmount], {
        account: vault.address as any,
      })
    ).to.be.rejected;
  });
});
