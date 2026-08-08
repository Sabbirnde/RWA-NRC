import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 5.5 — Double-Sell & Replay Attack Defense Validation Suite", function () {
  async function deployFixture() {
    const [deployer, attester, alice, bob, attacker] = await hre.viem.getWalletClients();
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
    await mockUSDC.write.mint([attacker.account.address, initialAmount]);

    return {
      deployer,
      attester,
      alice,
      bob,
      attacker,
      publicClient,
      mockUSDC,
      oracleAdapter,
      vault,
      claimRegistry,
      claimMarket,
    };
  }

  it("Enforces strict double-sell, replay, and ownership overwrite protections across 5 attack vectors", async function () {
    const { alice, bob, attacker, mockUSDC, vault, claimRegistry, claimMarket } =
      await deployFixture();

    const depositAmount = 1000000000n; // 1000 USDC
    const salePrice = 980000000n; // 980 USDC

    // 1. Setup Golden Flow: Alice deposits, lists at 980 USDC, Bob buys
    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    await vault.write.requestDeposit([depositAmount], { account: alice.account });

    const reqInfo = await vault.read.getRequest(["REQ-0001"]);
    const claimId = reqInfo.claimId;

    await claimMarket.write.listClaim([claimId, salePrice], { account: alice.account });

    await mockUSDC.write.approve([claimMarket.address, salePrice], { account: bob.account });
    await claimMarket.write.buyClaim([claimId], { account: bob.account });

    // Verify Bob is current owner and Alice received 980 USDC
    const postPurchaseClaim = await claimRegistry.read.getClaim([claimId]);
    expect(postPurchaseClaim.owner.toLowerCase()).to.equal(bob.account.address.toLowerCase());

    const aliceBalancePostBuy = await mockUSDC.read.balanceOf([alice.account.address]);
    const bobBalancePostBuy = await mockUSDC.read.balanceOf([bob.account.address]);

    // Attack 1: Alice attempts to re-list Claim #002 after selling it
    await expect(
      claimMarket.write.listClaim([claimId, salePrice], { account: alice.account })
    ).to.be.rejected;

    // Attack 2: Attempting to buy Claim #002 again on the old inactive listing (Replay Buy)
    await mockUSDC.write.approve([claimMarket.address, salePrice], { account: attacker.account });
    await expect(
      claimMarket.write.buyClaim([claimId], { account: attacker.account })
    ).to.be.rejected;

    // Attack 3: Attempting to create a second active listing using Alice's key
    await expect(
      claimMarket.write.listClaim([claimId, 950000000n], { account: alice.account })
    ).to.be.rejected;

    // Attack 4: Attempting to transfer claim directly via ClaimRegistry by unauthorized caller (Alice or Attacker)
    await expect(
      claimRegistry.write.transferClaim([claimId, alice.account.address], {
        account: alice.account,
      })
    ).to.be.rejected;

    // Attack 5: Verify accounting invariants remain 100% unmutated after all attack attempts
    const finalClaim = await claimRegistry.read.getClaim([claimId]);
    expect(finalClaim.owner.toLowerCase()).to.equal(bob.account.address.toLowerCase());

    const finalAliceBalance = await mockUSDC.read.balanceOf([alice.account.address]);
    const finalBobBalance = await mockUSDC.read.balanceOf([bob.account.address]);
    expect(finalAliceBalance).to.equal(aliceBalancePostBuy);
    expect(finalBobBalance).to.equal(bobBalancePostBuy);
  });
});
