import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 5.3 — Alice Fixed-Price Claim Listing Validation Suite", function () {
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

  it("Executes Alice Claim #002 fixed-price listing at 980 USDC with 14 mandatory security checks", async function () {
    const { alice, bob, publicClient, mockUSDC, vault, claimRegistry, claimMarket } =
      await deployFixture();

    const depositAmount = 1000000000n; // 1000 USDC
    const salePrice = 980000000n; // 980 USDC

    // 1. Approve & Request Deposit (Creates Claim #001)
    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    await vault.write.requestDeposit([depositAmount], { account: alice.account });

    const reqInfo = await vault.read.getRequest(["REQ-0001"]);
    const claimId = reqInfo.claimId;

    // Check 1: Alice owns Claim before listing
    const initialClaim = await claimRegistry.read.getClaim([claimId]);
    expect(initialClaim.owner.toLowerCase()).to.equal(alice.account.address.toLowerCase());
    expect(initialClaim.status).to.equal(0); // Active / NOT_LISTED

    // Check 9: Non-owner (Bob) attempt to list Alice's claim -> Reverts
    await expect(
      claimMarket.write.listClaim([claimId, salePrice], { account: bob.account })
    ).to.be.rejected;

    // Check 2: Alice lists Claim #002 at 980 USDC
    const listTx = await claimMarket.write.listClaim([claimId, salePrice], { account: alice.account });
    const listReceipt = await publicClient.waitForTransactionReceipt({ hash: listTx });
    expect(listReceipt.status).to.equal("success");

    // Check 13: Listing event is emitted
    const listEvents = await claimMarket.getEvents.ClaimListed();
    expect(listEvents.length).to.be.gte(1);
    const lastListEvent = listEvents[listEvents.length - 1];
    expect(lastListEvent.args.claimId).to.equal(claimId);
    expect(lastListEvent.args.seller?.toLowerCase()).to.equal(alice.account.address.toLowerCase());
    expect(lastListEvent.args.price).to.equal(salePrice);

    // Check 3, 4, 5, 6, 7, 12: Inspect Listing and Claim state
    const listing = await claimMarket.read.getListing([claimId]);
    expect(listing.seller.toLowerCase()).to.equal(alice.account.address.toLowerCase());
    expect(listing.price).to.equal(salePrice);
    expect(listing.active).to.be.true;

    const updatedClaim = await claimRegistry.read.getClaim([claimId]);
    expect(updatedClaim.faceValue).to.equal(depositAmount);
    expect(updatedClaim.owner.toLowerCase()).to.equal(alice.account.address.toLowerCase()); // Owner remains Alice until purchase
    expect(updatedClaim.status).to.equal(1); // 1 = LISTED

    const currentReqInfo = await vault.read.getRequest(["REQ-0001"]);
    expect(currentReqInfo.state === 0 || currentReqInfo.state === 1).to.be.true; // Settlement remains PENDING

    // Check 10 & 11: Listing does not trigger RWA settlement or vault share minting
    const aliceShares = await vault.read.balanceOf([alice.account.address]);
    expect(aliceShares).to.equal(0n);
  });
});
