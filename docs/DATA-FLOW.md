# Data Flow & Trust Boundary Specification

This document details the end-to-end data lifecycle from external real-world reference data to on-chain vault settlement.

---

## 🔀 Complete Data Pipeline Sequence

```
[1. External Web Data / Mock API]
               │
               ▼
[2. FirecrawlProvider] (Data Extraction)
               │
               ▼
[3. RWAAssetState Struct] (Normalization)
               │
               ▼
[4. ValidationEngine] (10-Point Sanity Check)
               │
               ▼
[5. FreshnessEngine] (MAX_DATA_AGE <= 300s Check)
               │
               ▼
[6. RiskEngine] (PASS / FAIL Evaluation)
               │
               ▼
[7. AttestationService] (EIP-712 Signing via ATTESTER_PRIVATE_KEY)
               │
               ▼
[8. RWAOracleAdapter.sol] (ECDSA Recovery & Nonce Check)
               │
               ▼
[9. AsyncRWAVault.sol] (onAttestationSettled Callback)
               │
               ▼
[10. User / Claim Owner] (claimShares / claimAssets)
```

---

## 🛡 Firecrawl Trust Boundary Rules

1. **Never Direct to Chain**: Raw Firecrawl data is **never** transmitted directly to smart contracts (`Firecrawl ⇏ Blockchain`).
2. **Explicit Labeling**: Firecrawl-sourced attributes in the UI are strictly labeled as `"External Reference Data"`, **never** `"Official Oracle"`.
3. **Backend Key Security**: `FIRECRAWL_API_KEY` is loaded exclusively in Node.js server environments (`process.env.FIRECRAWL_API_KEY`) and is never exposed in client bundles.
4. **Graceful Fallback**: If Firecrawl is unavailable or `FIRECRAWL_API_KEY` is unconfigured, `FirecrawlProvider` automatically falls back to `MockRWAProvider` without throwing uncaught exceptions.
