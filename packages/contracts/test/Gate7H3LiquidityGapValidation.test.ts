import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 7 — Hypothesis H3: Liquidity Gap Validation Suite", function () {
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

  it("H3 Empirical Flow — Proves T+0 liquidity realization before off-chain RWA settlement", async function () {
    const { attester, alice, bob, publicClient, mockUSDC, oracleAdapter, vault, claimRegistry, claimMarket, domain, types } = await deployFixture();

    const depositAmount = 1000000000n; // 1,000 USDC (6 decimals)
    const listPrice = 980000000n;      // 980 USDC (6 decimals)
    const initialAliceUsdc = await mockUSDC.read.balanceOf([alice.account.address]);
    const initialBobUsdc = await mockUSDC.read.balanceOf([bob.account.address]);

    // T0: Alice submits deposit request REQ-0001 (#H3-001)
    const t0Timestamp = (await publicClient.getBlock()).timestamp;
    await mockUSDC.write.approve([vault.address, depositAmount], { account: alice.account });
    const depositTx = await vault.write.requestDeposit([depositAmount], { account: alice.account });
    await publicClient.waitForTransactionReceipt({ hash: depositTx });

    // Verify REQ-0001 PENDING and Claim #1 Created
    const reqPending = await vault.read.getRequest(["REQ-0001"]);
    const claim1Id = await claimRegistry.read.requestIdToClaimId(["REQ-0001"]);
    const claim1Before = await claimRegistry.read.getClaim([claim1Id]);

    expect(reqPending.state).to.equal(1); // PENDING
    expect(claim1Before.owner.toLowerCase()).to.equal(alice.account.address.toLowerCase());
    expect(claim1Before.faceValue).to.equal(depositAmount);

    // T1 (T+0 Liquidity Realization): Alice lists Claim #1 at 980 USDC
    await claimMarket.write.listClaim([claim1Id, listPrice], { account: alice.account });

    // Bob purchases Claim #1 at 980 USDC
    await mockUSDC.write.approve([claimMarket.address, listPrice], { account: bob.account });
    const buyTx = await claimMarket.write.buyClaim([claim1Id], { account: bob.account });
    const buyReceipt = await publicClient.waitForTransactionReceipt({ hash: buyTx });
    const t1Timestamp = (await publicClient.getBlock()).timestamp;

    // Verify Alice receives 980 USDC cash immediately at T1 (before settlement!)
    const aliceUsdcAfterBuy = await mockUSDC.read.balanceOf([alice.account.address]);
    const bobUsdcAfterBuy = await mockUSDC.read.balanceOf([bob.account.address]);
    const claim1AfterBuy = await claimRegistry.read.getClaim([claim1Id]);

    expect(aliceUsdcAfterBuy).to.equal(initialAliceUsdc - depositAmount + listPrice); // Net: -20 USDC
    expect(bobUsdcAfterBuy).to.equal(initialBobUsdc - listPrice);
    expect(claim1AfterBuy.owner.toLowerCase()).to.equal(bob.account.address.toLowerCase()); // Ownership transferred to Bob

    // Invariant Check 1: Alice realized liquidity while request remains PENDING
    const reqStillPending = await vault.read.getRequest(["REQ-0001"]);
    expect(reqStillPending.state).to.equal(1); // STILL PENDING!
    expect(await vault.read.balanceOf([alice.account.address])).to.equal(0n);
    expect(await vault.read.balanceOf([bob.account.address])).to.equal(0n);

    // T2: Off-chain RWA settlement completes -> Attestation submitted
    const freshTimestamp = BigInt(Math.floor(Date.now() / 1000));
    const value = {
      assetId: "RWA-001",
      requestId: "REQ-0001",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: 501n,
      timestamp: freshTimestamp,
    };
    const signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });
    await oracleAdapter.write.submitAttestation([value, signature]);

    const reqClaimable = await vault.read.getRequest(["REQ-0001"]);
    expect(reqClaimable.state).to.equal(4); // CLAIMABLE

    // T3: Post-Market Payout Routing — Bob claims shares
    const settlementTx = await vault.write.claimShares(["REQ-0001"], { account: bob.account });
    const settlementReceipt = await publicClient.waitForTransactionReceipt({ hash: settlementTx });
    const t3Timestamp = (await publicClient.getBlock()).timestamp;

    const aliceSharesFinal = await vault.read.balanceOf([alice.account.address]);
    const bobSharesFinal = await vault.read.balanceOf([bob.account.address]);
    const reqFinalized = await vault.read.getRequest(["REQ-0001"]);

    expect(reqFinalized.state).to.equal(5); // FINALIZED
    expect(aliceSharesFinal).to.equal(0n); // Alice has 0 shares (already received 980 USDC cash at T1)
    expect(bobSharesFinal).to.equal(1000000000000000000000n); // Bob receives 1,000 vRWA shares

    console.log("=== GATE 7 H3 LIQUIDITY GAP EXPERIMENTAL EVIDENCE ===");
    console.log("Deposit Request ID: REQ-0001 (#H3-001)");
    console.log("Claim ID: Claim #1");
    console.log("Deposit Amount:", depositAmount.toString(), "(1,000 USDC)");
    console.log("Claim List Price:", listPrice.toString(), "(980 USDC)");
    console.log("Liquidity Realized Time (T1):", t1Timestamp.toString());
    console.log("Final Settlement Time (T3):", t3Timestamp.toString());
    console.log("Liquidity Latency vs Settlement Latency:", `${t1Timestamp - t0Timestamp}s vs ${t3Timestamp - t0Timestamp}s`);
    console.log("Alice Cash Balance Change:", "+980 USDC at T1");
    console.log("Bob Final vRWA Share Balance:", bobSharesFinal.toString(), "(1,000 vRWA)");
    console.log("Purchase Tx Hash:", buyReceipt.transactionHash);
    console.log("Settlement Tx Hash:", settlementReceipt.transactionHash);
  });
});
