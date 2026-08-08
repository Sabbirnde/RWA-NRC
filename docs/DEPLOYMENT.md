# Deployment & Network Setup Guide

This document outlines deployment procedures for local development (Hardhat / Anvil) and public testnets (Base Sepolia).

---

## 🛠 Local Anvil / Hardhat Node Deployment

```bash
# 1. Compile Smart Contracts
pnpm --filter @workspace/contracts run build

# 2. Deploy Contracts to Local Network
pnpm --filter @workspace/contracts run deploy
```

---

## 🌐 Base Sepolia Testnet Deployment

### 1. Environment Setup
In root `.env` (derived from `.env.example`):
```env
RPC_URL=https://sepolia.base.org
PRIVATE_KEY=0xYOUR_TESTNET_DEPLOYER_PRIVATE_KEY
ATTESTER_PRIVATE_KEY=0xYOUR_ATTESTER_SIGNER_PRIVATE_KEY
ETHERSCAN_API_KEY=YOUR_BASESCAN_API_KEY
```

### 2. Execute Deployment Script
```bash
pnpm deploy:testnet
```

Outputs contract addresses to `packages/contracts/deployment.json`:
- `MockUSDC`
- `RWAAssetRegistry`
- `RWAOracleAdapter`
- `ClaimRegistry`
- `AsyncRWAVault`
- `ClaimMarket`

### 3. Verify Source Code on Basescan
```bash
pnpm --filter @workspace/contracts hardhat verify --network baseSepolia <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```
