# Asynchronous RWA Vault + Real-World State Middleware + T+0 Claim Market

> **Asynchronous settlement and liquidity infrastructure for tokenized Real-World Assets (RWAs).**

This repository contains the complete functional Proof of Concept (PoC) demonstrating an asynchronous ERC-7540 tokenized vault, a Real-World State Middleware with Firecrawl data ingestion and EIP-712 attestation signing, and a peer-to-peer T+0 Claim Market to bridge early liquidity.

---

## 🏛 Core Architecture

```
                    REAL WORLD / EXTERNAL SOURCES
                                │
                                ▼
                      ┌──────────────────┐
                      │ RWA MIDDLEWARE   │
                      │                  │
                      │ Firecrawl        │
                      │ Mock RWA API     │
                      │ Webhook Events   │
                      │ Validation       │
                      │ Risk Engine      │
                      │ Attestation      │
                      └────────┬─────────┘
                               │ (EIP-712 Attestation)
                               ▼
                      ┌──────────────────┐
                      │ ORACLE ADAPTER   │
                      └────────┬─────────┘
                               │
                               ▼
                      ┌──────────────────┐
                      │ ERC-7540 VAULT   │
                      │                  │
                      │ Deposit Request  │
                      │ Pending State    │
                      │ Claimable State  │
                      │ Finalized Shares │
                      └────────┬─────────┘
                               │
                               ▼
                      ┌──────────────────┐
                      │ CLAIM MARKET     │
                      │                  │
                      │ T+0 Liquidity    │
                      └──────────────────┘
```

---

## ⚡ Key Features

1. **ERC-7540 Asynchronous Vault (`AsyncRWAVault.sol`)**:
   - Supports async deposit and redemption requests.
   - Enforces **Premature Minting Protection** (`claimableShares == 0` during `PENDING`). No shares are minted until off-chain attestation settles.

2. **Real-World State Middleware (`artifacts/api-server`)**:
   - Ingests reference data via Firecrawl & Mock RWA API.
   - Normalizes data, checks timestamp freshness (`MAX_DATA_AGE`), and evaluates deterministic risk (`PASS`/`FAIL`).
   - Produces **EIP-712 Typed Structured Data Signatures** for `RWAOracleAdapter.sol`.
   - Supports idempotent webhooks (`POST /api/webhooks/rwa-settlement`).

3. **T+0 Claim Marketplace (`ClaimMarket.sol` & `ClaimRegistry.sol`)**:
   - Enables depositors to list pending vault claims at a fixed discount.
   - Buyers purchase claims with immediate settlement, providing original depositors **T+0 liquidity** while the RWA completes its settlement window.

4. **Safety Principle**:
   - **When data is uncertain, delay settlement.**
   - Includes a **Simulate Invalid Data** failure mode toggle to demonstrate fail-closed protection.

---

## 🚀 Quick Start (Local Development)

### 1. Install Dependencies & Build Contracts
```bash
pnpm install
pnpm --filter @workspace/contracts run build
```

### 2. Run All Development Servers
```bash
pnpm run dev
```

- **Protocol Console Frontend**: `http://localhost:5173`
- **Component Mockup Sandbox**: `http://localhost:5174`
- **Middleware API Backend**: `http://localhost:5000`

---

## 📄 Documentation Map

- [Architecture Overview](docs/ARCHITECTURE.md)
- [Security & Invariants](docs/SECURITY.md)
- [Data Flow & Trust Boundary](docs/DATA-FLOW.md)
- [5-Minute Conference Demo Runbook](docs/DEMO.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
- [REST & Webhook API Reference](docs/API.md)
- [Threat Model](docs/THREAT-MODEL.md)
- [PoC Limitations & Assumptions](docs/ASSUMPTIONS.md)
