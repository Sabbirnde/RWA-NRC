# Validation Gate 3 — RWA Middleware Pipeline Report

---

## 1. Middleware Architecture & Pipeline Diagram

```text
External RWA Data (Firecrawl / Webhooks / APIs)
         │
         ▼
[ Raw Data Payload ]
         │
         ▼
[ NormalizationEngine ] (Standardizes Schema, Decimals, Asset IDs)
         │
         ▼
[ ValidationEngine ] (Schema & Parameter Bounds Checklist)
         │  ├─► Invalid NAV / Asset ID ──► REJECTED
         │  └─► Malformed Payload ───────► REJECTED
         ▼
[ FreshnessEngine ] (MAX_DATA_AGE = 300s Staleness Check)
         │  └─► Stale Data (> 300s) ─────► REJECTED / STALE
         ▼
[ RiskEngine ] (Custody Verification & Asset Risk Score)
         │  └─► Custody Unverified ──────► REJECTED / HIGH RISK
         ▼
[ AttestationService ] (Cryptographic EIP-712 Signature Generation)
         │
         ▼
EIP-712 Signed Attestation Payload Issued
```

---

## 2. Baseline Valid Payload & Expected Output (`RWA-001`)

### Input Payload Example (Valid RWA State)
```json
{
  "asset_id": "RWA-001",
  "valuation": 1000000,
  "yield_rate": 520,
  "custody_status": "VERIFIED",
  "settlement_status": "PENDING",
  "source": "https://rwa-oracle-feed.treasury.gov",
  "timestamp": 1770522108
}
```

### Output Attestation Structure (EIP-712 Signed Message)
```json
{
  "assetId": "RWA-001",
  "requestId": "REQ-0001",
  "state": "SETTLED",
  "nav": 1000000,
  "yieldRate": 520,
  "riskStatus": "0x0000000000000000000000000000000000000000000000000000000000000000",
  "nonce": 101,
  "timestamp": 1770522108,
  "signature": "0x4a9b...7c1a"
}
```

---

## 3. Pipeline Test Vectors & Validation Results

| Test Vector | Input Parameter Condition | Middleware Component Evaluation | Pipeline Result | Attestation Status | Status |
|---|---|---|---|---|---|
| **1. Valid Data** | NAV=1.0M, Yield=5.2%, Custody=VERIFIED | `Validation`: PASS \| `Freshness`: FRESH \| `Risk`: LOW | **PASSED** | **ISSUED** | **PASS** |
| **2. Missing Fields** | `assetId: ""` | `Validation`: Fail (`INVALID_ASSET_ID`) | **BLOCKED** | **NOT ISSUED** | **PASS** |
| **3. Invalid NAV** | `valuation: -1` | `Validation`: Fail (`INVALID_NAV`) | **BLOCKED** | **NOT ISSUED** | **PASS** |
| **4. Invalid Asset ID** | `asset_id: undefined` | `Validation`: Fail (`INVALID_ASSET_ID`) | **BLOCKED** | **NOT ISSUED** | **PASS** |
| **5. Invalid Custody** | `custody_status: "UNVERIFIED"` | `RiskEngine`: Fail (`CUSTODY_UNVERIFIED`) | **BLOCKED** | **NOT ISSUED** | **PASS** |
| **6. Invalid Settlement** | `status: "SETTLEMENT_FAILED"` | `RiskEngine`: Fail (`SETTLEMENT_FAILED`) | **BLOCKED** | **NOT ISSUED** | **PASS** |
| **7. Malformed Payload** | String `"CORRUPT_JSON"` | `Normalization`: Fail (`MALFORMED_PAYLOAD`) | **BLOCKED** | **NOT ISSUED** | **PASS** |
| **8. Unknown Asset** | `asset_id: "UNKNOWN-999"` | `MockProvider`: Throws (`UNKNOWN_ASSET`) | **BLOCKED** | **NOT ISSUED** | **PASS** |
| **9. Unexpected Source** | `source: "untrusted.xyz"` | `RiskEngine`: Fail (`UNTRUSTED_SOURCE`) | **BLOCKED** | **NOT ISSUED** | **PASS** |

---

## 4. Execution Logs & Observability Evidence

```text
[MIDDLEWARE LOG] Ingesting observation for asset RWA-001 from source https://rwa-oracle-feed.treasury.gov
[NORMALIZATION] Standardized NAV: 1,000,000 USD (6 decimals) | AssetId: RWA-001
[VALIDATION] Checklist: Positive NAV [OK] | Non-empty AssetId [OK] | Non-duplicate ObservationId [OK] -> VALID
[FRESHNESS] Timestamp: 1770522108 | Data Age: 0s | Threshold: 300s -> FRESH
[RISK ENGINE] Custody: VERIFIED | Yield: 5.2% | Risk Score: 0/100 -> LOW RISK (PASS)
[ATTESTATION] Issued EIP-712 Signature for REQ-0001 (Nonce: 101, Verifying Contract: 0x9fE4...012A)
```

---

## 5. Final Status

```text
========================================
FINAL STATUS: PASS
========================================
```
