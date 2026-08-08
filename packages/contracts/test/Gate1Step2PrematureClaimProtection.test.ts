import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 1 - STEP 2: Premature Claim Protection", function () {
  async function deployFixture() {
    const [userA, userB, attacker] = await hre.viem.getWalletClients();

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
      attacker,
      mockUSDC,
      claimRegistry,
      vault,
    };
  }

  it("Test 1 & 2 — Immediate Owner Claim Rejection: Owner calling claimShares while PENDING reverts", async function () {
    const { userA, mockUSDC, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });
    await vault.write.requestDeposit([1000000000n], { account: userA.account });

    const req = await vault.read.getRequest(["REQ-0001"]);
    expect(req.state).to.equal(1); // Pending

    await expect(
      vault.simulate.claimShares(["REQ-0001"], { account: userA.account })
    ).to.be.rejected;
  });

  it("Test 3 — Different User Premature Claim Rejection: Non-owner calling claimShares while PENDING reverts", async function () {
    const { userA, userB, mockUSDC, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });
    await vault.write.requestDeposit([1000000000n], { account: userA.account });

    await expect(
      vault.simulate.claimShares(["REQ-0001"], { account: userB.account })
    ).to.be.rejected;
  });

  it("Test 4 — Repeated Premature Claim Attempts: Multiple consecutive claim calls revert every time", async function () {
    const { userA, userB, mockUSDC, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });
    await vault.write.requestDeposit([1000000000n], { account: userA.account });

    await expect(
      vault.simulate.claimShares(["REQ-0001"], { account: userA.account })
    ).to.be.rejected;

    await expect(
      vault.simulate.claimShares(["REQ-0001"], { account: userA.account })
    ).to.be.rejected;

    await expect(
      vault.simulate.claimShares(["REQ-0001"], { account: userB.account })
    ).to.be.rejected;
  });

  it("Test 5 — State Preservation & Zero Minting: Failed claim attempts leave state PENDING and 0 shares", async function () {
    const { userA, mockUSDC, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });
    await vault.write.requestDeposit([1000000000n], { account: userA.account });

    try {
      await vault.write.claimShares(["REQ-0001"], { account: userA.account });
    } catch (e) {
      // Expected revert
    }

    const req = await vault.read.getRequest(["REQ-0001"]);
    expect(req.state).to.equal(1); // Pending preserved
    expect(req.claimableShares).to.equal(0n);

    const userShares = await vault.read.balanceOf([userA.account.address]);
    expect(userShares).to.equal(0n);
    const vaultTotalSupply = await vault.read.totalSupply();
    expect(vaultTotalSupply).to.equal(0n);
  });

  it("Test 6 — Claimable Amount Invariant: claimableShares == 0 while PENDING", async function () {
    const { userA, mockUSDC, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });
    await vault.write.requestDeposit([1000000000n], { account: userA.account });

    const req = await vault.read.getRequest(["REQ-0001"]);
    expect(req.claimableShares).to.equal(0n);
    expect(req.claimableAssets).to.equal(0n);
  });

  it("CRITICAL SECURITY TEST — Exhaustive Function Sweep: All claim/settle functions revert when PENDING", async function () {
    const { userA, attacker, mockUSDC, vault } = await deployFixture();

    await mockUSDC.write.faucet([userA.account.address, 1000000000n]);
    await mockUSDC.write.approve([vault.address, 1000000000n], { account: userA.account });
    await vault.write.requestDeposit([1000000000n], { account: userA.account });

    // 1. claimShares
    await expect(
      vault.simulate.claimShares(["REQ-0001"], { account: userA.account })
    ).to.be.rejected;

    // 2. claimAssets
    await expect(
      vault.simulate.claimAssets(["REQ-0001"], { account: userA.account })
    ).to.be.rejected;

    // 3. Unauthorized onAttestationSettled direct call
    await expect(
      vault.simulate.onAttestationSettled(["REQ-0001", 1000000000n], { account: attacker.account })
    ).to.be.rejected;

    // 4. Unauthorized onAttestationRejected direct call
    await expect(
      vault.simulate.onAttestationRejected(["REQ-0001", "FAKE_REASON"], { account: attacker.account })
    ).to.be.rejected;
  });
});
