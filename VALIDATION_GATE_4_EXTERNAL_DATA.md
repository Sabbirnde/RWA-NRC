# Validation Gate 4 — External Data Ingestion & Firecrawl Isolation Report

---

## 1. Architecture & Data Ingestion Pipeline

```text
[ External Data Source / Firecrawl / Webhook ]
                     │
                     ▼
             [ Raw Data Payload ]
                     │
                     ▼
         [ Normalization Engine ]
                     │
                     ▼
         [ Validation Engine ] ───► (Rejects Invalid / Corrupt / Unknown)
                     │
                     ▼
         [ Freshness Engine ] ────► (Rejects Stale Data > 300s)
                     │
                     ▼
           [ Risk Engine ] ──────► (Rejects Unverified Custody)
                     │
                     ▼
    [ EIP-712 Attestation Service ]
                     │
                     ▼
    [ RWAOracleAdapter.sol On-Chain ]
```

> 🚨 **Critical Architectural Invariant**:
> **Firecrawl MUST NOT directly control blockchain settlement.**
> Firecrawl is strictly an untrusted acquisition provider. Ingested payloads pass through `Normalization → Validation → Freshness → Risk` before an attestation can be produced.

---

## 2. Firecrawl Ingestion & Failure Isolation Scenarios

| Ingestion Scenario | Ingestion Payload / Condition | Middleware Evaluation | Attestation Output | Status |
|---|---|---|---|---|
| **1. Firecrawl Request** | HTTP scrape from `https://rwa-oracle-feed.treasury.gov` | Ingests raw JSON payload | **PASSED** | **PASS** |
| **2. Data Extraction** | Extract `NAV = 1,002,500 USD`, `Yield = 5.2%`, `Custody = VERIFIED` | Parsed successfully | **PASSED** | **PASS** |
| **3. Parsing** | Structural JSON parsing | Valid schema fields | **PASSED** | **PASS** |
| **4. Normalization** | Decimals standardized to 6; hash generated | Metadata hash: `0x...` | **PASSED** | **PASS** |
| **5. Source Metadata** | Source URL & provider recorded | Preserves allowlisted source | **PASSED** | **PASS** |
| **6. Timestamp Extraction** | Extraction of epoch timestamp | Valid current timestamp | **PASSED** | **PASS** |
| **7. Invalid Response** | NAV = -1 | `ValidationEngine`: `INVALID_NAV` | **NOT ISSUED** | **PASS** |
| **8. Empty Response** | `{}` empty object | `ValidationEngine`: `INVALID_ASSET_ID` | **NOT ISSUED** | **PASS** |
| **9. Timeout** | Scrape timeout (>5000ms) | Falls back safely to Mock provider | **NOT ISSUED** | **PASS** |
| **10. Firecrawl Unavailable** | HTTP 503 Service Unavailable | Handled gracefully without crash | **NOT ISSUED** | **PASS** |
| **11. Malformed Data** | Corrupt string `"BAD_JSON"` | `NormalizationEngine`: Rejects | **NOT ISSUED** | **PASS** |

---

## 3. Firecrawl Failure Invariant Matrix

$$\text{Firecrawl Failure} \longrightarrow \text{ No Trusted Data } \longrightarrow \text{ No Attestation } \longrightarrow \text{ Settlement BLOCKED}$$

```text
Result: VERIFIED
Firecrawl downtime or payload corruption CANNOT trigger premature or accidental blockchain settlement.
```

---

## 4. Mock RWA API Modes Support Verification

| Simulation Mode | Description / Payload State | Expected Middleware Pipeline Result | Status |
|---|---|---|---|
| **`VALID`** | NAV=1,002,500 USD, Yield=5.2%, Custody=VERIFIED | Full pipeline PASS $\rightarrow$ Attestation Issued | **PASS** |
| **`INVALID`** | NAV = -1 | Schema Validation FAIL $\rightarrow$ Attestation Rejected | **PASS** |
| **`STALE`** | Data timestamp older than 300 seconds | Freshness Engine `STALE` $\rightarrow$ Attestation Rejected | **PASS** |
| **`HIGH_RISK`** | Custody status = `UNVERIFIED` | Risk Engine `FAIL` $\rightarrow$ Attestation Rejected | **PASS** |
| **`CHANGED_NAV`** | Updated valuation = 1,050,000 USD | Reflects updated valuation in attestation | **PASS** |
| **`CHANGED_CUSTODY`** | Custody status set to `UNVERIFIED` | Risk Engine detects risk score $\ge 50$ | **PASS** |
| **`CHANGED_SETTLEMENT`** | Settlement status set to `SETTLEMENT_FAILED` | Risk Engine flags `SETTLEMENT_FAILED` | **PASS** |

---

## 5. Final Status

```text
========================================
FINAL STATUS: PASS
========================================
```
