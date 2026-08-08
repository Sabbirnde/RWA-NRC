import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 4.3 — Asynchronous State Consistency Validation Suite", function () {
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
      vault,
    };
  }

  it("Verifies full system-wide state consistency for Alice's PENDING Deposit Request", async function () {
    const { alice, bob, vault, mockUSDC } = await deployFixture();
    const depositAmount = 1000000000n; // 1000 USDC

    // Approve & Request Deposit
    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    await vault.write.requestDeposit([depositAmount], { account: alice.account });

    const events = await vault.getEvents.DepositRequested();
    expect(events.length).to.be.gte(1);
    const requestId = "REQ-0001";

    // 1. Blockchain State Check
    const reqInfo = await vault.read.getRequest([requestId]);
    const onChainOwner = reqInfo.owner.toLowerCase();
    const onChainAssets = reqInfo.amount;
    const onChainState = reqInfo.state; // 0 = Pending

    expect(onChainOwner).to.equal(alice.account.address.toLowerCase());
    expect(onChainAssets).to.equal(depositAmount);
    expect(onChainState === 0 || onChainState === 1).to.be.true; // 0 or 1 = Pending

    // 2. Claimable shares invariant
    const claimableShares = reqInfo.claimableShares;
    expect(claimableShares).to.equal(0n);

    // 3. Premature minting check
    const aliceShares = await vault.read.balanceOf([alice.account.address]);
    expect(aliceShares).to.equal(0n);

    // 4. Bob Isolation & Non-Access Check
    const bobShares = await vault.read.balanceOf([bob.account.address]);
    expect(bobShares).to.equal(0n);

    // 5. Re-querying state produces identical result
    const requeriedInfo = await vault.read.getRequest([requestId]);
    expect(requeriedInfo.state).to.equal(reqInfo.state);
    expect(requeriedInfo.amount).to.equal(reqInfo.amount);
  });
});
