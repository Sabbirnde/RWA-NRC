# Remaining Work & Production Readiness Roadmap

> **Current Status**: The functional Testnet Proof of Concept (PoC) for the Asynchronous RWA Vault + Real-World State Middleware + T+0 Claim Market is **100% complete**, fully compiled (`cancun` target), tested (6/6 security tests passing), and committed.

This document outlines the remaining steps required to transition this protocol from a functional testnet PoC to a production-grade institutional RWA infrastructure.

---

## 🗺 Remaining Work Checklist

| Category | Remaining Task | Priority | Complexity |
|---|---|---|---|
| **Deployment** | Live Base Sepolia Testnet Deployment & Explorer Source Verification | High | Moderate |
| **Frontend** | Direct On-Chain Contract Connection via `wagmi` / `viem` | Medium | Moderate |
| **Middleware** | Multi-Sig / Threshold Attestation Network Integration | Medium | High |
| **Indexing & DB** | PostgreSQL Persistent Ledger for Webhook Events & Historical Attestations | Medium | Low |
| **Security** | Formal Invariant Fuzzing (Echidna/Medusa) & Slither Static Analysis | High | High |

---

## 📖 Step-by-Step Guide

### Step 1: Live Testnet Deployment & Block Explorer Verification

#### Objective:
Deploy smart contracts to **Base Sepolia** testnet and verify source code on Basescan.

#### Execution Guide:

1. **Configure Environment Variables**:
   In `.env` (or root `.env.local`), set:
   ```env
   RPC_URL=https://sepolia.base.org
   PRIVATE_KEY=0xYOUR_TESTNET_DEPLOYER_PRIVATE_KEY
   ATTESTER_ADDRESS=0xYOUR_ATTESTER_SIGNER_ADDRESS
   ETHERSCAN_API_KEY=YOUR_BASESCAN_API_KEY
   ```

2. **Execute Deployment Script**:
   ```bash
   pnpm --filter @workspace/contracts run deploy --network baseSepolia
   ```
   This will output `packages/contracts/deployment.json` containing the deployed addresses:
   - `MockUSDC`
   - `RWAAssetRegistry`
   - `RWAOracleAdapter`
   - `ClaimRegistry`
   - `AsyncRWAVault`
   - `ClaimMarket`

3. **Verify Source Code on Basescan**:
   ```bash
   cd packages/contracts
   npx hardhat verify --network baseSepolia <DEPLOYED_VAULT_ADDRESS> "<MOCK_USDC_ADDRESS>" "<CLAIM_REGISTRY_ADDRESS>"
   ```

---

### Step 2: Direct On-Chain Contract Integration in Frontend

#### Objective:
Connect `rwa-protocol-console` directly to live testnet contracts via `wagmi` / `viem` so users can interact using MetaMask or WalletConnect.

#### Execution Guide:

1. **Add Contract ABIs to Frontend**:
   Import `packages/contracts/artifacts/contracts/AsyncRWAVault.sol/AsyncRWAVault.json` and `ClaimMarket.json` into `artifacts/rwa-protocol-console/src/lib/abi/`.

2. **Configure Wagmi Provider**:
   In `artifacts/rwa-protocol-console/src/main.tsx`, wrap the app with `WagmiProvider`:
   ```tsx
   import { createConfig, http, WagmiProvider } from 'wagmi';
   import { baseSepolia } from 'wagmi/chains';

   const config = createConfig({
     chains: [baseSepolia],
     transports: {
       [baseSepolia.id]: http(),
     },
   });
   ```

3. **Replace Direct API Mocks with `useWriteContract` / `useReadContract`**:
   Update `requestDeposit`, `claimShares`, `listClaim`, and `buyClaim` actions in `App.tsx` to execute real EVM wallet transactions.

---

### Step 3: Threshold Multi-Sig Attestation Signer

#### Objective:
Upgrade the single-key `ATTESTER_PRIVATE_KEY` to a 2-of-3 threshold signature scheme (m-of-n multi-sig or Chainlink Functions).

#### Execution Guide:

1. **Update `RWAOracleAdapter.sol`**:
   Add support for threshold signature arrays:
   ```solidity
   function submitThresholdAttestation(
       AttestationParams calldata params,
       bytes[] calldata signatures
   ) external returns (bool);
   ```

2. **Update `attestationService.ts`**:
   Generate multiple signatures across independent key shares and verify quorum before submitting to `RWAOracleAdapter`.

---

### Step 4: PostgreSQL Ledger Indexer for Webhooks & Claims

#### Objective:
Persist historical attestations, claim transfers, and settlement webhook logs to PostgreSQL using Drizzle ORM.

#### Execution Guide:

1. **Define Drizzle Schema (`lib/db/src/schema/attestations.ts`)**:
   ```ts
   import { pgTable, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";

   export const attestations = pgTable("attestations", {
     id: text("id").primaryKey(),
     requestId: text("request_id").notNull(),
     assetId: text("asset_id").notNull(),
     nav: integer("nav").notNull(),
     signature: text("signature").notNull(),
     timestamp: timestamp("timestamp").defaultNow(),
   });
   ```

2. **Push Migration**:
   ```bash
   pnpm --filter @workspace/db run push
   ```

3. **Log Webhook Events**:
   Update `artifacts/api-server/src/routes/webhooks.ts` to write incoming events to PostgreSQL for audit trailing.

---

### Step 5: Formal Security Audit & Invariant Fuzzing

#### Objective:
Run static analysis (Slither) and property-based fuzzing (Echidna) on smart contracts.

#### Execution Guide:

1. **Run Slither Static Analysis**:
   ```bash
   cd packages/contracts
   slither .
   ```

2. **Run Echidna Property Fuzzing**:
   Define property assertions in `test/invariants/VaultInvariants.sol`:
   ```solidity
   function echidna_pending_never_has_shares() public view returns (bool) {
       return vault.balanceOf(pendingUser) == 0;
   }
   ```
