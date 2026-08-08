import fs from "fs";
import path from "path";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

async function main() {
  const [deployer, attester, alice, bob] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();

  console.log("==========================================");
  console.log("GATE 11: E2E Golden Path Execution (Testnet)");
  console.log("==========================================\n");

  // 1. Deploy Contracts
  console.log("[1] Deploying Contracts...");
  const mockUSDC = await hre.viem.deployContract("MockUSDC");
  const assetRegistry = await hre.viem.deployContract("RWAAssetRegistry");
  const oracleAdapter = await hre.viem.deployContract("RWAOracleAdapter", [attester.account.address, assetRegistry.address]);
  const claimRegistry = await hre.viem.deployContract("ClaimRegistry");
  const vault = await hre.viem.deployContract("AsyncRWAVault", [mockUSDC.address, claimRegistry.address]);
  const claimMarket = await hre.viem.deployContract("ClaimMarket", [mockUSDC.address, claimRegistry.address]);

  // Link contracts
  await assetRegistry.write.setOracleAdapter([oracleAdapter.address]);
  await oracleAdapter.write.setVault([vault.address]);
  await vault.write.setOracleAdapter([oracleAdapter.address]);
  await claimRegistry.write.setVault([vault.address]);
  await claimRegistry.write.setClaimMarket([claimMarket.address]);

  console.log(`- Vault: ${vault.address}`);
  console.log(`- ClaimMarket: ${claimMarket.address}`);
  console.log(`- OracleAdapter: ${oracleAdapter.address}\n`);

  // Setup funds
  const initialFunds = 100000000000n; // 100,000 USDC
  await mockUSDC.write.mint([alice.account.address, initialFunds]);
  await mockUSDC.write.mint([bob.account.address, initialFunds]);

  // SCENARIO 1: Alice Deposit Request #001 -> Settlement
  console.log("[2] Alice Request #001 (Direct Settlement)");
  let txHash = await mockUSDC.write.approve([vault.address, 1000n], { account: alice.account });
  console.log(`  > Alice Approve USDC Tx: ${txHash}`);
  
  txHash = await vault.write.requestDeposit([1000n], { account: alice.account });
  const receiptReq1 = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`  > Alice Deposit Tx: ${txHash} (Block: ${receiptReq1.blockNumber})`);

  let req1 = await vault.read.getRequest(["REQ-0001"]);
  console.log(`  > Request #001 State: ${req1.state} (PENDING)`);

  // Oracle Settlement for REQ-0001
  const domain = { name: "RWA-OracleAdapter", version: "1.0.0", chainId: await publicClient.getChainId(), verifyingContract: oracleAdapter.address };
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

  let block = await publicClient.getBlock();
  let timestamp = block.timestamp;
  let value = { assetId: "RWA-001", requestId: "REQ-0001", state: "SETTLED", nav: 1000n, yieldRate: 520n, riskStatus: "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`, nonce: 1n, timestamp };
  let signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });
  
  txHash = await oracleAdapter.write.submitAttestation([value, signature]);
  const receiptSet1 = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`  > Oracle Attest Tx: ${txHash} (Block: ${receiptSet1.blockNumber})`);
  
  txHash = await vault.write.claimShares(["REQ-0001"], { account: alice.account });
  const receiptClaim1 = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`  > Alice Claim Shares Tx: ${txHash} (Block: ${receiptClaim1.blockNumber})\n`);

  // SCENARIO 2: Alice Request #002 -> Claim Market -> Bob Settles
  console.log("[3] Alice Request #002 (Claim Market T+0 Liquidity)");
  txHash = await mockUSDC.write.approve([vault.address, 1000n], { account: alice.account });
  txHash = await vault.write.requestDeposit([1000n], { account: alice.account });
  const receiptReq2 = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`  > Alice Deposit Tx: ${txHash} (Block: ${receiptReq2.blockNumber})`);

  txHash = await claimMarket.write.listClaim([2n, 980n], { account: alice.account });
  const receiptList = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`  > Alice List Claim #2 Tx: ${txHash} (Block: ${receiptList.blockNumber})`);

  txHash = await mockUSDC.write.approve([claimMarket.address, 980n], { account: bob.account });
  txHash = await claimMarket.write.buyClaim([2n], { account: bob.account });
  const receiptBuy = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`  > Bob Buy Claim #2 Tx: ${txHash} (Block: ${receiptBuy.blockNumber})`);
  
  const owner = await claimRegistry.read.getClaimOwner([2n]);
  console.log(`  > Claim #2 Owner: ${owner} (Expected Bob: ${bob.account.address})\n`);

  // Oracle Settlement for REQ-0002
  console.log("[4] Bob Settles Request #002");
  block = await publicClient.getBlock();
  timestamp = block.timestamp;
  value = { ...value, requestId: "REQ-0002", nonce: 2n, timestamp };
  signature = await attester.signTypedData({ domain, types, primaryType: "Attestation", message: value });
  
  txHash = await oracleAdapter.write.submitAttestation([value, signature]);
  const receiptSet2 = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`  > Oracle Attest Tx: ${txHash} (Block: ${receiptSet2.blockNumber})`);
  
  txHash = await vault.write.claimShares(["REQ-0002"], { account: bob.account });
  const receiptClaim2 = await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log(`  > Bob Claim Shares Tx: ${txHash} (Block: ${receiptClaim2.blockNumber})\n`);

  const bobShares = await vault.read.balanceOf([bob.account.address]);
  console.log(`  > Bob Final vRWA Balance: ${bobShares}`);

  // Save report data
  const reportData = {
    network: hre.network.name,
    chainId: await publicClient.getChainId(),
    contracts: {
      Vault: vault.address,
      ClaimMarket: claimMarket.address,
      OracleAdapter: oracleAdapter.address,
    },
    scenario1: {
      depositTx: receiptReq1.transactionHash,
      depositBlock: receiptReq1.blockNumber.toString(),
      attestTx: receiptSet1.transactionHash,
      attestBlock: receiptSet1.blockNumber.toString(),
      claimTx: receiptClaim1.transactionHash,
      claimBlock: receiptClaim1.blockNumber.toString(),
    },
    scenario2: {
      depositTx: receiptReq2.transactionHash,
      depositBlock: receiptReq2.blockNumber.toString(),
      listTx: receiptList.transactionHash,
      listBlock: receiptList.blockNumber.toString(),
      buyTx: receiptBuy.transactionHash,
      buyBlock: receiptBuy.blockNumber.toString(),
      attestTx: receiptSet2.transactionHash,
      attestBlock: receiptSet2.blockNumber.toString(),
      claimTx: receiptClaim2.transactionHash,
      claimBlock: receiptClaim2.blockNumber.toString(),
    }
  };

  const reportPath = path.resolve(process.cwd(), "e2e-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
  console.log(`\nReport data saved to ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
