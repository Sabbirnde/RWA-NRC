import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 7 — H3 Step 6: Post-Market RWA Settlement & Payout Routing Suite", function () {
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

  it("Step 6 Post-Market Settlement — Executes RWA attestation & routes 1,000 vRWA shares to Bob", async function () {
    const { attester, alice, bob, publicClient, mockUSDC, oracleAdapter, vault, claimRegistry, claimMarket, domain, types } = await deployFixture();

    const depositAmount = 1000000000n; // 1000 USDC
    const salePrice = 980000000n;      // 980 USDC

    // 1. Alice Deposit Request REQ-0001 & Claim #1 Created
    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    const depositTx = await vault.write.requestDeposit([depositAmount], { account: alice.account });
    const depositReceipt = await publicClient.waitForTransactionReceipt({ hash: depositTx });
    const t0_claim_created = (await publicClient.getBlock({ blockHash: depositReceipt.blockHash })).timestamp;

    // 2. Alice lists Claim #1 for 980 USDC & Bob buys it
    await claimMarket.write.listClaim([1n, salePrice], { account: alice.account });
    await mockUSDC.write.approve([claimMarket.address, salePrice], { account: bob.account });
    const buyTx = await claimMarket.write.buyClaim([1n], { account: bob.account });
    const buyReceipt = await publicClient.waitForTransactionReceipt({ hash: buyTx });
    const t1_purchased = (await publicClient.getBlock({ blockHash: buyReceipt.blockHash })).timestamp;

    // 3. RWA Middleware Pipeline -> EIP-712 Attestation Submitted
    const freshTimestamp = BigInt(Math.floor(Date.now() / 1000));
    const value = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: 601n,
      timestamp: freshTimestamp,
    };
    const signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });
    const attestationTx = await oracleAdapter.write.submitAttestation([value, signature]);
    const attestationReceipt = await publicClient.waitForTransactionReceipt({ hash: attestationTx });
    const t2_attested = (await publicClient.getBlock({ blockHash: attestationReceipt.blockHash })).timestamp;

    // 4. Vault Settlement (Bob claims shares)
    const settlementTx = await vault.write.claimShares(["REQ-0001"], { account: bob.account });
    const settlementReceipt = await publicClient.waitForTransactionReceipt({ hash: settlementTx });
    const t3_settled = (await publicClient.getBlock({ blockHash: settlementReceipt.blockHash })).timestamp;

    // Inspect Final On-Chain State
    const claimFinal = await claimRegistry.read.getClaim([1n]);
    const reqFinal = await vault.read.getRequest(["REQ-0001"]);
    const aliceFinalUsdc = await mockUSDC.read.balanceOf([alice.account.address]);
    const bobFinalUsdc = await mockUSDC.read.balanceOf([bob.account.address]);
    const aliceSharesFinal = await vault.read.balanceOf([alice.account.address]);
    const bobSharesFinal = await vault.read.balanceOf([bob.account.address]);

    // Mandatory Invariant Assertions
    expect(attestationReceipt.status).to.equal("success");
    expect(settlementReceipt.status).to.equal("success");
    expect(reqFinal.state).to.equal(5); // FINALIZED
    expect(claimFinal.status).to.equal(3); // Settled (Enum index 3)
    expect(claimFinal.owner.toLowerCase()).to.equal(bob.account.address.toLowerCase());

    // Economic Flow Verification
    expect(aliceFinalUsdc).to.equal(99980000000n); // Net: +980 USDC at T+0
    expect(bobFinalUsdc).to.equal(99020000000n);   // Net: -980 USDC at purchase
    expect(aliceSharesFinal).to.equal(0n);           // Alice has 0 shares
    expect(bobSharesFinal).to.equal(1000000000000000000000n); // Bob receives 1,000 vRWA shares ($1,000 value)

    console.log("=== GATE 7 H3 STEP 6 POST-MARKET SETTLEMENT LIFECYCLE EVIDENCE ===");
    console.log("Deposit Request ID: REQ-0001 | Claim ID: #1");
    console.log("Attestation Tx Hash:", attestationTx, "(Block #" + attestationReceipt.blockNumber + ")");
    console.log("Settlement Tx Hash:", settlementTx, "(Block #" + settlementReceipt.blockNumber + ")");
    console.log("Timestamps: t0=" + t0_claim_created + "s | t1=" + t1_purchased + "s | t2=" + t2_attested + "s | t3=" + t3_settled + "s");
    console.log("Claim Final Status: Settled (3)");
    console.log("Claim Final Owner:", claimFinal.owner, "(Bob)");
    console.log("Alice Final USDC Balance: 99,980.00 USDC (+980 USDC at T+0)");
    console.log("Bob Final USDC Balance: 99,020.00 USDC (-980 USDC at purchase)");
    console.log("Bob Final vRWA Share Balance:", bobSharesFinal.toString(), "(1,000 vRWA shares)");
  });
});
