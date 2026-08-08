import { expect } from "chai";
import hre from "hardhat";

describe("AsyncRWAVault & Protocol Ecosystem", function () {
  async function deployFixture() {
    const [owner, attester, user1, user2] = await hre.viem.getWalletClients();
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
      publicClient,
      mockUSDC,
      assetRegistry,
      oracleAdapter,
      claimRegistry,
      vault,
      claimMarket,
    };
  }

  it("Should process deposit request without premature minting", async function () {
    const { user1, mockUSDC, vault } = await deployFixture();

    // Mint USDC for user1
    await mockUSDC.write.faucet([user1.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], {
      account: user1.account,
    });

    // Submit deposit request
    await vault.write.requestDeposit([1000000000n], {
      account: user1.account,
    });

    // Invariant: Premature minting protection - shares balance must be 0 before settlement
    const userShares = await vault.read.balanceOf([user1.account.address]);
    expect(userShares).to.equal(0n);

    const req = await vault.read.getRequest(["REQ-0001"]);
    expect(req.amount).to.equal(1000000000n);
    expect(req.claimableShares).to.equal(0n);
    expect(req.state).to.equal(1); // Pending
  });
});
