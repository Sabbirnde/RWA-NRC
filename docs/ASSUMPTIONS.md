# Proof of Concept (PoC) Limitations & Scope Disclosures

> [!IMPORTANT]  
> This repository is a **functional Testnet Proof of Concept (PoC)** built to demonstrate asynchronous vault mechanics, off-chain state middleware, and fixed-price claim markets. It is **NOT** a production-grade financial platform.

---

## ⚠️ Explicit PoC Scope Disclosures

1. **Firecrawl Data is Reference Data Only**:
   Data extracted via Firecrawl represents unverified external web data (e.g., from Treasury.gov) and is **not authoritative financial data**.

2. **Mock Provider is Not a Bank**:
   The `MockRWAProvider` is a synthetic software component for demo simulation; it does not connect to real fiat banking networks, custodians, or ACH/Fedwire rails.

3. **Centralized Attestation Signer in PoC**:
   EIP-712 attestations are generated using a single dedicated private key (`ATTESTER_PRIVATE_KEY`). Production environments require a Multi-Sig or Decentralized Threshold Network (e.g. Chainlink Functions / MPC).

4. **No Legal Ownership Enforcement**:
   The `ClaimRegistry` tracks on-chain entitlement tokens for demo flows. No off-chain legal transfer contracts, SPV agreements, or legal recourse mechanisms are enforced.

5. **No Production Security Audit**:
   The smart contracts and TypeScript middleware have not undergone a formal third-party security audit.

6. **No Production Oracle Network**:
   The system relies on a local gateway adapter (`RWAOracleAdapter.sol`) rather than a multi-node decentralized oracle network.

7. **Simplified Claim Market**:
   `ClaimMarket.sol` implements a basic fixed-price listing and buying mechanism. Production secondary markets require orderbooks, dynamic pricing, and AMM pools.

8. **Testnet Only**:
   The software is strictly intended for local testing (Anvil/Hardhat) and public testnet deployments (**Base Sepolia**).

---

## ⚡ PoC Performance Targets & SLA Guidelines

The PoC prioritizes **correctness, security, and demonstrability** over premature micro-optimization. The system adheres to the following pragmatic performance targets:

| Component / Layer | Performance Target (SLA) | Operational Context |
|---|---|---|
| **API Server Responses** | **< 2 seconds** | Standard REST telemetry endpoints (`/api/protocol/summary`, `/api/protocol/requests`). |
| **Middleware Pipeline** | **< 5 seconds** | Full pipeline execution (Ingest -> Normalize -> Validate -> Risk -> EIP-712 Sign), excluding external web scrapers. |
| **Frontend State Refresh** | **< 5 seconds** | TanStack Query refetch interval for live conference telemetry updates. |
| **Firecrawl Ingestion** | **< 30 seconds** | Live web extraction target for external Treasury yield pages. |
| **Blockchain Confirmation** | *Network Dependent* | Block inclusion time on Base Sepolia (~2s per block) or instant on local Anvil. |

---

## 📦 Installed Library Compatibility Matrix (Section 51)

The protocol uses the actual, current dependency versions installed in the workspace without relying on deprecated APIs:

| Library / Standard | Installed Version | Current API Usage |
|---|---|---|
| **OpenZeppelin Contracts** | `^5.2.0` | OpenZeppelin v5.2 (`ERC20`, `SafeERC20`, `Ownable`, `Pausable`, `ReentrancyGuard`, `ECDSA`, `EIP712`). |
| **Viem** | `^2.23.0` | Viem v2.23.0 for off-chain EIP-712 typed data hashing (`hashTypedData`) & contract interaction. |
| **Hardhat & Ignition** | `^2.22.18` | Hardhat v2.22.18 with `@nomicfoundation/hardhat-viem` v2.0.0 (EVMCancun target). |
| **Firecrawl API** | Standard v1 REST | `FirecrawlProvider` utilizing structured web scrape / extract endpoints. |
| **TanStack React Query** | `v5` | Asynchronous query caching & refetching for live conference telemetry. |

---

## 📌 Technical & Operational Assumptions

1. **In-Memory Demonstration State**:
   Telemetry and request timeline logs operate on fast in-memory maps in `artifacts/api-server`. Production setups should integrate a persistent PostgreSQL indexer.

2. **ERC-7540 Async Vault Semantics**:
   The vault enforces ERC-7540 asynchronous deposit and redemption queues, storing request sequence numbers on-chain in `AsyncRWAVault.sol`.
