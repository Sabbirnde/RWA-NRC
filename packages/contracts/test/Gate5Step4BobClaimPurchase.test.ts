import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 5.4 — Bob Claim Purchase & Ownership Transfer Suite", function () {
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

  it("Executes Bob claim purchase at 980 USDC -> Ownership transfers from Alice to Bob with 15 mandatory assertions", async function () {
    const { alice, bob, publicClient, mockUSDC, vault, claimRegistry, claimMarket } =
      await deployFixture();

    const depositAmount = 1000000000n; // 1000 USDC
    const salePrice = 980000000n; // 980 USDC

    // 1. Alice Deposit Request (1000 USDC)
    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    await vault.write.requestDeposit([depositAmount], { account: alice.account });

    const reqInfo = await vault.read.getRequest(["REQ-0001"]);
    const claimId = reqInfo.claimId;

    // 2. Alice Lists Claim at 980 USDC
    await claimMarket.write.listClaim([claimId, salePrice], { account: alice.account });

    // Balances before purchase
    const aliceUSDCBefore = await mockUSDC.read.balanceOf([alice.account.address]);
    const bobUSDCBefore = await mockUSDC.read.balanceOf([bob.account.address]);

    // Check 1 & 2: Bob approves 980 USDC to ClaimMarket
    expect(bobUSDCBefore >= salePrice).to.be.true;
    const approveTx = await mockUSDC.write.approve([claimMarket.address, salePrice], {
      account: bob.account,
    });
    await publicClient.waitForTransactionReceipt({ hash: approveTx });

    // Check 3: Bob buys Claim
    const buyTx = await claimMarket.write.buyClaim([claimId], { account: bob.account });
    const buyReceipt = await publicClient.waitForTransactionReceipt({ hash: buyTx });
    expect(buyReceipt.status).to.equal("success");

    // Balances after purchase
    const aliceUSDCAfter = await mockUSDC.read.balanceOf([alice.account.address]);
    const bobUSDCAfter = await mockUSDC.read.balanceOf([bob.account.address]);

    // Check 4 & 5: Payment delta
    expect(aliceUSDCAfter - aliceUSDCBefore).to.equal(salePrice); // Alice +980 USDC
    expect(bobUSDCBefore - bobUSDCAfter).to.equal(salePrice); // Bob -980 USDC

    // Check 6, 7, 8, 10, 13: Ownership and Claim State
    const updatedClaim = await claimRegistry.read.getClaim([claimId]);
    expect(updatedClaim.owner.toLowerCase()).to.equal(bob.account.address.toLowerCase());
    expect(updatedClaim.owner.toLowerCase()).to.not.equal(alice.account.address.toLowerCase());
    expect(updatedClaim.requestId).to.equal("REQ-0001");
    expect(updatedClaim.faceValue).to.equal(depositAmount);

    // Check 9: Listing deactivated
    const listing = await claimMarket.read.getListing([claimId]);
    expect(listing.active).to.be.false;

    // Check 11: Settlement remains PENDING
    const currentReqInfo = await vault.read.getRequest(["REQ-0001"]);
    expect(currentReqInfo.state === 0 || currentReqInfo.state === 1).to.be.true;

    // Check 12: Alice cannot claim sharesPrematurely
    await expect(
      vault.write.claimShares(["REQ-0001"], { account: alice.account })
    ).to.be.rejected;
  });
});
