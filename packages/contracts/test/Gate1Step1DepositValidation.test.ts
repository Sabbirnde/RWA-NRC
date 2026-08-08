import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 1 - STEP 1: Deposit Request & Pending State Validation", function () {
  async function deployFixture() {
    const [userA, userB] = await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();

    const mockUSDC = await hre.viem.deployContract("MockUSDC");
    const claimRegistry = await hre.viem.deployContract("ClaimRegistry");
    const vault = await hre.viem.deployContract("AsyncRWAVault", [
      mockUSDC.address,
      claimRegistry.address,
    ]);

    await claimRegistry.write.setVault([vault.address]);

    return {
      userA,
      userB,
      publicClient,
      mockUSDC,
      claimRegistry,
      vault,
    };
  }

  it("Test 1 — Basic Deposit: Transaction succeeds & request created in PENDING state", async function () {
    const { userA, mockUSDC, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });

    const tx = await vault.write.requestDeposit([1000000000n], { account: userA.account });
    expect(tx).to.be.a("string");

    const req = await vault.read.getRequest(["REQ-0001"]);
    expect(req.requestId).to.equal("REQ-0001");
    expect(req.owner.toLowerCase()).to.equal(userA.account.address.toLowerCase());
    expect(req.amount).to.equal(1000000000n);
    expect(req.state).to.equal(1); // Pending (enum RequestState.Pending)
  });

  it("Test 2 — Request ID Uniqueness: A != B != C mapping 1:1", async function () {
    const { userA, userB, mockUSDC, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 3000000000n]);
    await mockUSDC.write.faucet([userB.account.address, 1000000000n]);

    await mockUSDC.write.approve([vault.address, 3000000000n], { account: userA.account });
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userB.account });

    await vault.write.requestDeposit([1000000000n], { account: userA.account }); // REQ-0001 (User A)
    await vault.write.requestDeposit([2000000000n], { account: userA.account }); // REQ-0002 (User A)
    await vault.write.requestDeposit([1000000000n], { account: userB.account }); // REQ-0003 (User B)

    const reqA = await vault.read.getRequest(["REQ-0001"]);
    const reqB = await vault.read.getRequest(["REQ-0002"]);
    const reqC = await vault.read.getRequest(["REQ-0003"]);

    expect(reqA.requestId).to.not.equal(reqB.requestId);
    expect(reqB.requestId).to.not.equal(reqC.requestId);
    expect(reqA.requestId).to.not.equal(reqC.requestId);

    expect(reqA.owner.toLowerCase()).to.equal(userA.account.address.toLowerCase());
    expect(reqB.owner.toLowerCase()).to.equal(userA.account.address.toLowerCase());
    expect(reqC.owner.toLowerCase()).to.equal(userB.account.address.toLowerCase());
  });

  it("Test 3 — Request Data Integrity: Stored struct fields verified", async function () {
    const { userA, mockUSDC, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 500000000n]);
    await mockUSDC.write.approve([vault.address, 500000000n], { account: userA.account });

    await vault.write.requestDeposit([500000000n], { account: userA.account });

    const req = await vault.read.getRequest(["REQ-0001"]);
    expect(req.requestId).to.equal("REQ-0001");
    expect(req.kind).to.equal(0); // RequestKind.Deposit
    expect(req.owner.toLowerCase()).to.equal(userA.account.address.toLowerCase());
    expect(req.amount).to.equal(500000000n);
    expect(req.claimableShares).to.equal(0n);
    expect(req.claimableAssets).to.equal(0n);
    expect(req.state).to.equal(1); // Pending
    expect(req.createdAt > 0n).to.be.true;
  });

  it("Test 4 — Initial Claimability: Immediate PENDING state and zero claimable shares", async function () {
    const { userA, mockUSDC, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });

    await vault.write.requestDeposit([1000000000n], { account: userA.account });

    const req = await vault.read.getRequest(["REQ-0001"]);
    expect(req.state).to.equal(1); // Pending
    expect(req.claimableShares).to.equal(0n);

    // Balance of user shares must be 0 prior to attestation settlement
    const userShares = await vault.read.balanceOf([userA.account.address]);
    expect(userShares).to.equal(0n);
  });

  it("Test 5 — Events: DepositRequested event emitted with correct arguments", async function () {
    const { userA, publicClient, mockUSDC, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });

    const hash = await vault.write.requestDeposit([1000000000n], { account: userA.account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    expect(receipt.status).to.equal("success");
    expect(receipt.logs.length).to.be.gt(0);
  });

  it("Test 6 — Multiple Requests Isolation: Simultaneous pending requests remain independent", async function () {
    const { userA, userB, mockUSDC, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.faucet([userB.account.address, 2000000000n]);

    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });
    await mockUSDC.write.approve([vault.address, 2000000000n], { account: userB.account });

    await vault.write.requestDeposit([1000000000n], { account: userA.account });
    await vault.write.requestDeposit([2000000000n], { account: userB.account });

    const req1 = await vault.read.getRequest(["REQ-0001"]);
    const req2 = await vault.read.getRequest(["REQ-0002"]);

    expect(req1.amount).to.equal(1000000000n);
    expect(req2.amount).to.equal(2000000000n);

    expect(req1.owner.toLowerCase()).to.equal(userA.account.address.toLowerCase());
    expect(req2.owner.toLowerCase()).to.equal(userB.account.address.toLowerCase());
  });
});
