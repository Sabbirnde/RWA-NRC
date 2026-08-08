import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 5.1 — Claim Market & Secondary Liquidity Infrastructure Validation Suite", function () {
  async function deployFixture() {
    const [deployer, attester, alice, bob, unauthorized] = await hre.viem.getWalletClients();
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
      unauthorized,
      publicClient,
      mockUSDC,
      oracleAdapter,
      vault,
      claimRegistry,
      claimMarket,
    };
  }

  it("1 & 2. Pending Deposit creates a Claim with a Unique Claim ID", async function () {
    const { alice, vault, mockUSDC, claimRegistry } = await deployFixture();
    const depositAmount = 1000000000n; // 1000 USDC

    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    await vault.write.requestDeposit([depositAmount], { account: alice.account });

    const reqInfo = await vault.read.getRequest(["REQ-0001"]);
    expect(reqInfo.claimId > 0n).to.be.true;

    const claim = await claimRegistry.read.getClaim([reqInfo.claimId]);
    expect(claim.claimId).to.equal(reqInfo.claimId);
  });

  it("3. Claim stores complete metadata schema", async function () {
    const { alice, vault, mockUSDC, claimRegistry } = await deployFixture();
    const depositAmount = 1000000000n;

    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    await vault.write.requestDeposit([depositAmount], { account: alice.account });

    const reqInfo = await vault.read.getRequest(["REQ-0001"]);
    const claim = await claimRegistry.read.getClaim([reqInfo.claimId]);

    expect(claim.claimId).to.equal(reqInfo.claimId);
    expect(claim.requestId).to.equal("REQ-0001");
    expect(claim.assetId).to.equal("RWA-001");
    expect(claim.owner.toLowerCase()).to.equal(alice.account.address.toLowerCase());
    expect(claim.faceValue).to.equal(depositAmount);
    expect(claim.status).to.equal(0); // 0 = Active / Pending
  });

  it("4. Claim ownership is distinguishable and transferable on secondary market", async function () {
    const { alice, bob, vault, mockUSDC, claimRegistry, claimMarket } = await deployFixture();
    const depositAmount = 1000000000n;

    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    await vault.write.requestDeposit([depositAmount], { account: alice.account });

    const reqInfo = await vault.read.getRequest(["REQ-0001"]);
    const claimId = reqInfo.claimId;

    // Alice lists claim at 980 USDC
    await claimMarket.write.listClaim([claimId, 980000000n], { account: alice.account });
    const claimListed = await claimRegistry.read.getClaim([claimId]);
    expect(claimListed.status).to.equal(1); // 1 = Listed

    // Bob purchases claim
    await mockUSDC.write.approve([claimMarket.address, 980000000n], { account: bob.account });
    await claimMarket.write.buyClaim([claimId], { account: bob.account });

    const claimPurchased = await claimRegistry.read.getClaim([claimId]);
    expect(claimPurchased.owner.toLowerCase()).to.equal(bob.account.address.toLowerCase());
    expect(claimPurchased.owner.toLowerCase()).to.not.equal(alice.account.address.toLowerCase());
  });

  it("6. Unauthorized caller cannot create a claim directly without a valid vault deposit", async function () {
    const { unauthorized, claimRegistry } = await deployFixture();

    await expect(
      claimRegistry.write.createClaim(["REQ-FAKE", "RWA-001", unauthorized.account.address, 1000n], {
        account: unauthorized.account,
      })
    ).to.be.rejected;
  });

  it("7. Settled/Finalized claim cannot become tradable or listed", async function () {
    const { deployer, alice, vault, mockUSDC, claimRegistry, claimMarket } = await deployFixture();
    const depositAmount = 1000000000n;

    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    await vault.write.requestDeposit([depositAmount], { account: alice.account });

    const reqInfo = await vault.read.getRequest(["REQ-0001"]);
    const claimId = reqInfo.claimId;

    // Mark settled by authorized owner (deployer)
    await claimRegistry.write.markClaimSettled([claimId], { account: deployer.account });

    await expect(
      claimMarket.write.listClaim([claimId, 980000000n], { account: alice.account })
    ).to.be.rejected;
  });
});
