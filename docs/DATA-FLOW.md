# Data Flow & Trust Boundary Specification

This document details the end-to-end data lifecycle from external real-world reference data to on-chain vault settlement.

---

## 🔀 Complete Data Pipeline Sequence

```mermaid
flowchart LR
    RW["Real World / External Sources"]
    FC["Firecrawl"]
    API["Mock RWA API"]
    MW["RWA Middleware"]
    VAL["Validation + Freshness"]
    RISK["Risk Engine"]
    ATT["Attestation Service"]
    ORACLE["Oracle Adapter"]
    VAULT["ERC-7540 Async Vault"]
    CLAIM["Claim Registry"]
    MARKET["Claim Market"]
    USER["User"]

    RW --> FC
    API --> MW
    FC --> MW
    MW --> VAL
    VAL --> RISK
    RISK --> ATT
    ATT --> ORACLE
    ORACLE --> VAULT
    VAULT --> CLAIM
    CLAIM --> MARKET
    MARKET --> USER
```

---

## 🌉 On-Chain / Off-Chain Gap Bridge Diagram

```mermaid
flowchart TD
    subgraph OFFCHAIN["🌐 OFF-CHAIN REAL WORLD"]
        ISSUER["Issuer"]
        BANK["Bank / Custodian Simulation"]
        YIELD["Interest / Yield"]
        NAV["Net Asset Value (NAV)"]
        SETTLE_OFF["Off-Chain Settlement"]
        CREDIT["Credit Risk"]
        WEB["External Web Data (Treasury.gov)"]
    end

    subgraph MIDDLEWARE["⚡ RWA MIDDLEWARE (THE BRIDGE)"]
        INGEST["Ingestion (Firecrawl / Mock API)"]
        NORM["Normalization (RWAAssetState)"]
        VAL["Validation Engine (10 Checks + Freshness)"]
        RISK_ENG["Risk Engine (PASS / FAIL)"]
        STATE_ENG["State Engine (Request Lifecycle)"]
        ATTEST["Attestation Service (EIP-712 Signing)"]

        INGEST --> NORM
        NORM --> VAL
        VAL --> RISK_ENG
        RISK_ENG --> STATE_ENG
        STATE_ENG --> ATTEST
    end

    subgraph ONCHAIN["⛓️ ON-CHAIN BLOCKCHAIN"]
        REQ["Deposit / Redeem Request"]
        VAULT["AsyncRWAVault State"]
        SHARES["vRWA Vault Shares"]
        CLAIMS["ClaimRegistry Tokens"]
        SETTLE_ON["Settlement Callback"]
        MARKET["Fixed-Price Claim Market"]

        REQ --> VAULT
        VAULT --> CLAIMS
        CLAIMS --> MARKET
        SETTLE_ON --> SHARES
    end

    OFFCHAIN --> INGEST
    ATTEST -->|"Signed EIP-712 Proof"| ORACLE["RWAOracleAdapter.sol"]
    ORACLE --> SETTLE_ON
```

---

## 🛡 Firecrawl Trust Boundary Rules

1. **Never Direct to Chain**: Raw Firecrawl data is **never** transmitted directly to smart contracts (`Firecrawl ⇏ Blockchain`).
2. **Explicit Labeling**: Firecrawl-sourced attributes in the UI are strictly labeled as `"External Reference Data"`, **never** `"Official Oracle"`.
3. **Backend Key Security**: `FIRECRAWL_API_KEY` is loaded exclusively in Node.js server environments (`process.env.FIRECRAWL_API_KEY`) and is never exposed in client bundles.
4. **Graceful Fallback**: If Firecrawl is unavailable or `FIRECRAWL_API_KEY` is unconfigured, `FirecrawlProvider` automatically falls back to `MockRWAProvider` without throwing uncaught exceptions.
