import { expect } from "chai";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

describe("GATE 8 — Independent Research Hypothesis H3 Validation Suite", function () {
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

  it("Executes full Gate 8 H3 Scenario: Proves Settlement Latency != Liquidity Latency across 7 mandatory conditions", async function () {
    const { attester, alice, bob, publicClient, mockUSDC, oracleAdapter, vault, claimRegistry, claimMarket, domain, types } = await deployFixture();

    const depositAmount = 1000000000n; // 1000 USDC
    const salePrice = 980000000n;      // 980 USDC

    // 1. Alice Deposit Request REQ-0001 & REQ-0002 (Claim #002)
    await mockUSDC.write.approve([vault.address, 2000000000n], { account: alice.account });
    await vault.write.requestDeposit([1000000000n], { account: alice.account }); // REQ-0001

    const depositTx2 = await vault.write.requestDeposit([1000000000n], { account: alice.account }); // REQ-0002 -> Claim #002
    const depositReceipt2 = await publicClient.waitForTransactionReceipt({ hash: depositTx2 });
    const t0 = (await publicClient.getBlock({ blockHash: depositReceipt2.blockHash })).timestamp;

    const claimId2 = 2n;

    // 2. Alice lists Claim #002 for 980 USDC
    const listTx = await claimMarket.write.listClaim([claimId2, salePrice], { account: alice.account });
    const listReceipt = await publicClient.waitForTransactionReceipt({ hash: listTx });

    // 3. Bob buys Claim #002 for 980 USDC
    await mockUSDC.write.approve([claimMarket.address, salePrice], { account: bob.account });
    const buyTx = await claimMarket.write.buyClaim([claimId2], { account: bob.account });
    const buyReceipt = await publicClient.waitForTransactionReceipt({ hash: buyTx });
    const t1 = (await publicClient.getBlock({ blockHash: buyReceipt.blockHash })).timestamp;

    // ASSERTION 1: Alice receives liquidity immediately at T+0 (+980 USDC)
    const aliceUsdcAfterBuy = await mockUSDC.read.balanceOf([alice.account.address]);
    expect(aliceUsdcAfterBuy).to.equal(98980000000n);

    // ASSERTION 2: Bob becomes claim owner
    const claimAfterBuy = await claimRegistry.read.getClaim([claimId2]);
    expect(claimAfterBuy.owner.toLowerCase()).to.equal(bob.account.address.toLowerCase());

    // ASSERTION 3: Underlying RWA settlement is STILL PENDING
    const reqAfterBuy = await vault.read.getRequest(["REQ-0002"]);
    expect(reqAfterBuy.state).to.equal(1); // PENDING

    // ASSERTION 4: Claim remains linked to REQ-0002
    const linkedReq = await vault.read.claimIdToRequestId([claimId2]);
    expect(linkedReq).to.equal("REQ-0002");

    // 4. Later Off-Chain RWA Attestation & Vault Settlement
    const timestamp = BigInt(Math.floor(Date.now() / 1000));
    const value = {
      assetId: "RWA-001",
      requestId: "REQ-0002",
      state: "SETTLED",
      nav: 1000000n,
      yieldRate: 520n,
      riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
      nonce: 8001n,
      timestamp,
    };
    const signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });
    await oracleAdapter.write.submitAttestation([value, signature]);

    const settlementTx = await vault.write.claimShares(["REQ-0002"], { account: bob.account });
    const settlementReceipt = await publicClient.waitForTransactionReceipt({ hash: settlementTx });
    const t2 = (await publicClient.getBlock({ blockHash: settlementReceipt.blockHash })).timestamp;

    // ASSERTION 5: Later settlement belongs economically to Bob (1,000 vRWA shares)
    const bobShares = await vault.read.balanceOf([bob.account.address]);
    expect(bobShares).to.equal(1000000000000000000000n);

    // ASSERTION 6: Alice cannot reclaim or relist the claim
    await expect(claimMarket.write.listClaim([claimId2, salePrice], { account: alice.account })).to.be.rejectedWith("NotClaimOwner");

    // ASSERTION 7: Bob cannot receive duplicate settlement
    await expect(vault.write.claimShares(["REQ-0002"], { account: bob.account })).to.be.rejectedWith("RequestNotClaimable");

    console.log("=== GATE 8 H3 INDEPENDENT EVIDENCE ===");
    console.log("Request ID: REQ-0002 | Claim ID: Claim #002");
    console.log("Deposit Tx Hash:", depositTx2, "(Block #" + depositReceipt2.blockNumber + ", t0=" + t0 + "s)");
    console.log("List Tx Hash:", listTx, "(Block #" + listReceipt.blockNumber + ")");
    console.log("Buy Tx Hash:", buyTx, "(Block #" + buyReceipt.blockNumber + ", t1=" + t1 + "s)");
    console.log("Settlement Tx Hash:", settlementTx, "(Block #" + settlementReceipt.blockNumber + ", t2=" + t2 + "s)");
    console.log("Ownership: Alice -> Bob");
    console.log("Liquidity Delay (t1 - t0):", (t1 - t0).toString() + "s");
    console.log("Settlement Delay (t2 - t0):", (t2 - t0).toString() + "s");
  });
});
