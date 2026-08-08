# Development Priority Matrix & Production Readiness Roadmap

> **Implementation Order**: The protocol was built strictly following a core-first development hierarchy: **P0 (Core Protocol Mechanics) ──> P1 (Liquidity & External Data) ──> P2 (Testing, Simulation & Polish)**.

---

## 🎯 15-Point Development Priority Matrix

### 🔴 Priority 0 (P0) — Core Protocol Mechanics
| Step | Feature / Component | Source Location | Status |
|---|---|---|---|
| 1. | **ERC-7540 Async Vault** | `AsyncRWAVault.sol` | ✅ **100% COMPLETE** |
| 2. | **Request / Claim Lifecycle** | `AsyncRWAVault.sol:L130-L210` | ✅ **100% COMPLETE** |
| 3. | **Oracle Adapter Gateway** | `RWAOracleAdapter.sol` | ✅ **100% COMPLETE** |
| 4. | **RWA State Middleware** | `artifacts/api-server/src/routes/protocol.ts` | ✅ **100% COMPLETE** |
| 5. | **EIP-712 Typed Attestation** | `RWAOracleAdapter.sol:L60-L85` | ✅ **100% COMPLETE** |
| 6. | **Mock RWA Provider API** | `artifacts/api-server/src/services/mockRwaProvider.ts` | ✅ **100% COMPLETE** |
| 7. | **End-to-End Pipeline Flow** | Full test suite & middleware integration | ✅ **100% COMPLETE** |

### 🟡 Priority 1 (P1) — Liquidity Bridge & External Data
| Step | Feature / Component | Source Location | Status |
|---|---|---|---|
| 8. | **Firecrawl Web Extraction** | `artifacts/api-server/src/services/firecrawlProvider.ts` | ✅ **100% COMPLETE** |
| 9. | **Claim Registry Token Ledger** | `ClaimRegistry.sol` | ✅ **100% COMPLETE** |
| 10. | **Fixed-Price Claim Market** | `ClaimMarket.sol` | ✅ **100% COMPLETE** |
| 11. | **Frontend Console Dashboard** | `artifacts/rwa-protocol-console` | ✅ **100% COMPLETE** |

### 🟢 Priority 2 (P2) — Testing, Simulation & Polish
| Step | Feature / Component | Source Location | Status |
|---|---|---|---|
| 12. | **18-Case Unit Security Testing** | `packages/contracts/test/AsyncRWAVault.test.ts` | ✅ **100% COMPLETE** |
| 13. | **Invalid Data Failure Simulation** | `artifacts/rwa-protocol-console` (Failure Toggle) | ✅ **100% COMPLETE** |
| 14. | **Full System Documentation** | 9 comprehensive `.md` specification files | ✅ **100% COMPLETE** |
| 15. | **Institutional UI Polish** | Tailored dark-mode UI with status pills & links | ✅ **100% COMPLETE** |

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
