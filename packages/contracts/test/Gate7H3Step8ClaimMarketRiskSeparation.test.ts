import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 7 — H3 Step 8: Claim Market Risk Separation & Settlement Independence Suite", function () {
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

    const domain = {
      name: "RWA-OracleAdapter",
      version: "1.0.0",
      chainId: 31337,
      verifyingContract: oracleAdapter.address,
    };
    const types = {
      Attestation: [
        { name: "assetId", type: "string" },
        { name: "requestId", type: "string" },
        { name: "state", type: "string" },
        { name: "nav", type: "uint256" },
        { name: "yieldRate", type: "uint256" },
        { name: "riskStatus", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "timestamp", type: "uint256" },
      ],
    };

    return {
      attester,
      alice,
      bob,
      publicClient,
      mockUSDC,
      oracleAdapter,
      vault,
      claimRegistry,
      claimMarket,
      domain,
      types,
    };
  }

  it("Step 8 Risk Separation — Proves claim purchase transfers liquidity to Alice without guaranteeing RWA settlement when data is stale", async function () {
    const { attester, alice, bob, publicClient, mockUSDC, oracleAdapter, vault, claimRegistry, claimMarket, domain, types } = await deployFixture();

    const depositAmount = 1000000000n; // 1000 USDC
    const salePrice = 950000000n;      // 950 USDC (5% discount)

    // 1. Create deposit request REQ-0001 (Claim #1)
    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    await vault.write.requestDeposit([depositAmount], { account: alice.account }); // REQ-0001 -> Claim #1

    const claimId = 1n;

    // 2. Alice lists Claim #1 for 950 USDC
    await claimMarket.write.listClaim([claimId, salePrice], { account: alice.account });

    // 3. Bob purchases Claim #1 for 950 USDC
    await mockUSDC.write.approve([claimMarket.address, salePrice], { account: bob.account });
    await claimMarket.write.buyClaim([claimId], { account: bob.account });

    // 4. Intentionally Simulate Stale Off-Chain RWA Attestation Submission (37m old timestamp)
    const staleTimestamp = BigInt(Math.floor(Date.now() / 1000) - 2220);
    const staleValue = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: 801n,
      timestamp: staleTimestamp,
    };
    const staleSig = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: staleValue });

    // Attestation submission MUST REJECT
    await expect(oracleAdapter.write.submitAttestation([staleValue, staleSig])).to.be.rejectedWith("StaleAttestation");

    // Bob attempts to claim shares -> MUST REVERT
    await expect(vault.write.claimShares(["REQ-0001"], { account: bob.account })).to.be.rejectedWith("RequestNotClaimable");

    // Inspect Final On-Chain State
    const aliceUsdc = await mockUSDC.read.balanceOf([alice.account.address]);
    const bobUsdc = await mockUSDC.read.balanceOf([bob.account.address]);
    const claim = await claimRegistry.read.getClaim([claimId]);
    const req = await vault.read.getRequest(["REQ-0001"]);
    const bobShares = await vault.read.balanceOf([bob.account.address]);

    // Mandatory Assertions
    expect(aliceUsdc).to.equal(99950000000n); // Net +950 USDC cash realized by Alice
    expect(bobUsdc).to.equal(99050000000n);   // Net -950 USDC cash paid by Bob
    expect(claim.owner.toLowerCase()).to.equal(bob.account.address.toLowerCase()); // Bob owns claim
    expect(claim.status).to.equal(2); // Transferred (NOT settled)
    expect(req.state).to.equal(1); // PENDING (RWA NOT settled)
    expect(bobShares).to.equal(0n); // 0 vRWA shares

    console.log("=== GATE 7 H3 STEP 8 RISK SEPARATION EVIDENCE ===");
    console.log("Claim ID: Claim #1 (Face Value: 1,000 USDC | Sale Price: 950 USDC)");
    console.log("Alice Cash Realized:", "+950 USDC at T+0");
    console.log("Bob Cash Paid:", "-950 USDC at T+0");
    console.log("Bob Claim Ownership:", "CONFIRMED (Owner: Bob | Status: Transferred)");
    console.log("Underlying RWA Settlement Status:", "NOT SETTLED (RequestState.Pending = 1)");
    console.log("Bob Shares Issued:", "0 vRWA");
    console.log("Attestation Revert Reason:", "StaleAttestation()");
    console.log("Vault Claim Revert Reason:", "RequestNotClaimable()");
  });
});
