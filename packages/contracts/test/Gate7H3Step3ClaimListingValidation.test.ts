import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 7 — H3 Step 3: Pending Claim Market Listing Validation Suite", function () {
  async function deployFixture() {
    const [deployer, attester, alice] = await hre.viem.getWalletClients();
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

    // Create deposit request REQ-0001 (Claim #1) & REQ-0002 (Claim #2)
    await mockUSDC.write.approve([vault.address, 2000000000n], { account: alice.account });
    await vault.write.requestDeposit([1000000000n], { account: alice.account }); // REQ-0001
    await vault.write.requestDeposit([1000000000n], { account: alice.account }); // REQ-0002 -> Claim #2

    return {
      alice,
      publicClient,
      mockUSDC,
      vault,
      claimRegistry,
      claimMarket,
    };
  }

  it("Step 3 — Verifies Alice can list Claim #2 at 980 USDC without triggering underlying RWA settlement", async function () {
    const { alice, publicClient, vault, claimRegistry, claimMarket } = await deployFixture();
    const claimId = 2n;
    const salePrice = 980000000n; // 980 USDC

    // Execute Alice listClaim(Claim #2, 980 USDC)
    const listTx = await claimMarket.write.listClaim([claimId, salePrice], { account: alice.account });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: listTx });
    const block = await publicClient.getBlock({ blockHash: receipt.blockHash });

    // Inspect On-Chain State
    const listing = await claimMarket.read.getListing([claimId]);
    const claim = await claimRegistry.read.getClaim([claimId]);
    const req = await vault.read.getRequest(["REQ-0002"]);
    const aliceShares = await vault.read.balanceOf([alice.account.address]);

    // Mandatory Invariant Assertions
    expect(receipt.status).to.equal("success");
    expect(listing.claimId).to.equal(claimId);
    expect(listing.seller.toLowerCase()).to.equal(alice.account.address.toLowerCase());
    expect(listing.price).to.equal(salePrice);
    expect(listing.active).to.equal(true);

    expect(claim.faceValue).to.equal(1000000000n); // 1,000 USDC
    expect(claim.status).to.equal(1); // Listed (Enum index 1)

    // CRITICAL REQUIREMENT: Listing MUST NOT trigger RWA settlement
    expect(req.state).to.equal(1); // PENDING (Enum index 1)
    expect(req.claimableShares).to.equal(0n);
    expect(aliceShares).to.equal(0n);

    console.log("=== GATE 7 H3 STEP 3 CLAIM LISTING EVIDENCE ===");
    console.log("Transaction Hash:", listTx);
    console.log("Block Number:", receipt.blockNumber.toString());
    console.log("t_listed:", block.timestamp.toString(), "(Epoch seconds)");
    console.log("Claim ID:", claimId.toString());
    console.log("Seller:", listing.seller, "(Alice)");
    console.log("Face Value:", claim.faceValue.toString(), "(1,000 USDC)");
    console.log("Sale Price:", listing.price.toString(), "(980 USDC)");
    console.log("Listing Status:", listing.active ? "ACTIVE" : "INACTIVE");
    console.log("Claim Status:", "Listed (1)");
    console.log("Underlying Vault Request State:", "PENDING (1)");
    console.log("Underlying Settlement Completed:", "NO (0 claimable shares, 0 vRWA minted)");
  });
});
