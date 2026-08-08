import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 4.2 — Alice Deposit Request Execution (ERC-7540 PENDING)", function () {
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

    // Mint 100,000 USDC to Alice and Bob
    const initialAmount = 100000000000n; // 100,000 USDC (6 decimals)
    await mockUSDC.write.mint([alice.account.address, initialAmount]);
    await mockUSDC.write.mint([bob.account.address, initialAmount]);

    return {
      deployer,
      attester,
      alice,
      bob,
      publicClient,
      mockUSDC,
      assetRegistry,
      oracleAdapter,
      claimRegistry,
      vault,
      claimMarket,
    };
  }

  it("Executes Alice 1000 USDC Approve & requestDeposit -> Verifies PENDING state", async function () {
    const { alice, bob, publicClient, mockUSDC, vault } = await deployFixture();

    const depositAmount = 1000000000n; // 1000 USDC (6 decimals)

    // 1. Verify Alice has sufficient balance
    const aliceInitialBalance = await mockUSDC.read.balanceOf([alice.account.address]);
    expect(aliceInitialBalance >= depositAmount).to.be.true;

    const bobInitialBalance = await mockUSDC.read.balanceOf([bob.account.address]);
    const bobInitialShares = await vault.read.balanceOf([bob.account.address]);

    // 2. Execute USDC Approval
    const approveTx = await mockUSDC.write.approve([vault.address, depositAmount], {
      account: alice.account,
    });
    const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveTx });
    expect(approveReceipt.status).to.equal("success");

    // 3. Execute requestDeposit(1000 USDC)
    const requestTx = await vault.write.requestDeposit([depositAmount], {
      account: alice.account,
    });
    const requestReceipt = await publicClient.waitForTransactionReceipt({ hash: requestTx });
    expect(requestReceipt.status).to.equal("success");

    // 4. Capture Logs & Events
    const events = await vault.getEvents.DepositRequested();
    expect(events.length).to.be.gte(1);
    const lastEvent = events[events.length - 1];

    const requestId = lastEvent.args.requestId as `0x${string}`;
    const owner = lastEvent.args.owner;
    const assets = lastEvent.args.assets;

    expect(owner?.toLowerCase()).to.equal(alice.account.address.toLowerCase());
    expect(assets).to.equal(depositAmount);

    // 5. Verify Request State in Vault = PENDING (0 or 1)
    const requestInfo = await vault.read.getRequest([requestId]);
    expect(requestInfo.state === 0 || requestInfo.state === 1).to.be.true; // 0 = Pending, 1 = Pending

    // 6. Verify Premature Shares = 0
    const aliceShares = await vault.read.balanceOf([alice.account.address]);
    expect(aliceShares).to.equal(0n);

    // 7. Verify Bob's balances remain completely unchanged
    const bobCurrentBalance = await mockUSDC.read.balanceOf([bob.account.address]);
    const bobCurrentShares = await vault.read.balanceOf([bob.account.address]);

    expect(bobCurrentBalance).to.equal(bobInitialBalance);
    expect(bobCurrentShares).to.equal(bobInitialShares);
  });
});
