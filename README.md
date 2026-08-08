# Asynchronous RWA Vault + Real-World State Middleware + T+0 Claim Market

> **Asynchronous settlement and liquidity infrastructure for tokenized Real-World Assets (RWAs).**
> *(This is NOT a generic RWA tokenization platform. It is institutional infrastructure designed specifically for asynchronous banking settlement and temporal liquidity gaps.)*

### 🌟 Most Important Engineering Principle
> **Build the smallest architecture that genuinely demonstrates the research hypothesis.**
>
> ❌ **Do NOT attempt to build**:
> - A complete bank
> - A complete oracle network
> - A production exchange
> - A legal RWA infrastructure
> - A production financial product
>
> 🎯 **The PoC exists solely to prove the architecture.**

### 🎯 Core Positioning Principle:
- **ERC-7540** handles the asynchronous vault.
- **Our middleware** handles asynchronous real-world state.
- **The claim market** handles the liquidity gap.

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

## ⚠️ Proof of Concept (PoC) Scope & Disclosures

- **Firecrawl Data**: Sourced web data is reference information, not authoritative financial data.
- **Mock Provider**: Software simulation component; does not connect to real banks or fiat wires.
- **Attestation Signer**: Single dedicated key in PoC; requires MPC / Multi-Sig for production.
- **Legal Recourse**: No off-chain legal contracts or SPV ownership enforcement is implemented.
- **Audit Status**: Contracts and middleware have not undergone a third-party security audit.
- **Oracle Network**: Local oracle gateway; not a decentralized multi-node oracle network.
- **Claim Market**: Simplified fixed-price inventory model.
- **Environment**: Testnet and local development only (**Base Sepolia** / Anvil).

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

## 📄 Complete Documentation Map

- [📊 Canonical RWA Data Layer Specification](docs/RWA_DATA_SPEC.md)
- [🏅 Sequential Validation Chain Certification](docs/VALIDATION-CHAIN-CERTIFICATION.md)
- [🏛 Architecture Audit Report](docs/ARCHITECTURE_AUDIT.md)
- [🏆 Final Protocol Completion Report](docs/FINAL-REPORT.md)
- [Architecture Overview](docs/ARCHITECTURE.md)
- [Protocol Accounting Model & Invariants](docs/ACCOUNTING.md)
- [Security & Invariants](docs/SECURITY.md)
- [Data Flow & Trust Boundary](docs/DATA-FLOW.md)
- [5-Minute Conference Demo Runbook](docs/DEMO.md)
- [Deployment & Network Setup Guide](docs/DEPLOYMENT.md)
- [REST & Webhook API Reference](docs/API.md)
- [Threat Model & Risk Analysis](docs/THREAT-MODEL.md)
- [Protocol Limitations & Assumptions](docs/ASSUMPTIONS.md)
- [Remaining Work & Production Roadmap](docs/REMAINING-WORK-ROADMAP.md)
