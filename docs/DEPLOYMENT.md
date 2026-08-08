# Deployment Guide

## Prerequisites

- Node.js 20+
- pnpm 10+

## Local Hardhat Node Deployment

```bash
# 1. Compile smart contracts
pnpm --filter @workspace/contracts run build

# 2. Run local hardhat network node (optional)
npx hardhat node

# 3. Deploy smart contracts
pnpm --filter @workspace/contracts run deploy
```

## Base Sepolia Testnet Deployment

Set environment variables in `.env`:
```env
RPC_URL=https://sepolia.base.org
PRIVATE_KEY=0x...
ATTESTER_ADDRESS=0x...
```

Deploy:
```bash
pnpm --filter @workspace/contracts run deploy --network baseSepolia
```
