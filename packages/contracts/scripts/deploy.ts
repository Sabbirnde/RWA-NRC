import fs from "fs";
import path from "path";
import hre from "hardhat";
import "@nomicfoundation/hardhat-toolbox-viem";

async function main() {
  const [deployer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();

  console.log("Deploying RWA Protocol contracts with account:", deployer.account.address);

  const mockUSDC = await hre.viem.deployContract("MockUSDC");
  console.log("MockUSDC deployed to:", mockUSDC.address);

  const assetRegistry = await hre.viem.deployContract("RWAAssetRegistry");
  console.log("RWAAssetRegistry deployed to:", assetRegistry.address);

  const attesterAddress = process.env.ATTESTER_ADDRESS || deployer.account.address;
  const oracleAdapter = await hre.viem.deployContract("RWAOracleAdapter", [
    attesterAddress,
    assetRegistry.address,
  ]);
  console.log("RWAOracleAdapter deployed to:", oracleAdapter.address);

  const claimRegistry = await hre.viem.deployContract("ClaimRegistry");
  console.log("ClaimRegistry deployed to:", claimRegistry.address);

  const vault = await hre.viem.deployContract("AsyncRWAVault", [
    mockUSDC.address,
    claimRegistry.address,
  ]);
  console.log("AsyncRWAVault deployed to:", vault.address);

  const claimMarket = await hre.viem.deployContract("ClaimMarket", [
    mockUSDC.address,
    claimRegistry.address,
  ]);
  console.log("ClaimMarket deployed to:", claimMarket.address);

  // Link contracts
  await assetRegistry.write.setOracleAdapter([oracleAdapter.address]);
  await oracleAdapter.write.setVault([vault.address]);
  await vault.write.setOracleAdapter([oracleAdapter.address]);
  await claimRegistry.write.setVault([vault.address]);
  await claimRegistry.write.setClaimMarket([claimMarket.address]);

  const deploymentData = {
    network: hre.network.name,
    chainId: await publicClient.getChainId(),
    deployer: deployer.account.address,
    attester: attesterAddress,
    contracts: {
      MockUSDC: mockUSDC.address,
      RWAAssetRegistry: assetRegistry.address,
      RWAOracleAdapter: oracleAdapter.address,
      ClaimRegistry: claimRegistry.address,
      AsyncRWAVault: vault.address,
      ClaimMarket: claimMarket.address,
    },
    timestamp: new Date().toISOString(),
  };

  const outputPath = path.resolve(process.cwd(), "deployment.json");
  fs.writeFileSync(outputPath, JSON.stringify(deploymentData, null, 2));
  console.log("Deployment saved to:", outputPath);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
