# RWA Middleware Processing & Policy Specification

> **Frozen Baseline Architecture Segment**:  
> `RWA Middleware (Normalize ──> Validate ──> Freshness ──> Risk Engine ──> State Machine)`

---

## 1. NORMALIZE (`NormalizationEngine`)

The `NormalizationEngine` enforces deterministic data formatting so that identical input observations yield identical normalized objects and SHA-256 metadata hashes:

* **Asset IDs**: Trimmed and uppercase (e.g. `" rwa-001 "` ──> `"RWA-001"`).
* **Valuation & Decimals**: Rounded to 2 decimal places and converted to standard 6-decimal integers (`valuation6Decimals` e.g., 1,002,500 ──> `1002500000000n`).
* **Currency**: Standardized uppercase ISO code (`"usd"` ──> `"USD"`).
* **Decimals**: Enforced standard of `6` decimals.
* **Timestamps**: Integer epoch seconds.
* **Metadata Canonicalization**: Keys sorted alphabetically before computing `metadataHash` (`sha256(JSON.stringify(sortedMetadata))`).

---

## 2. VALIDATE (`ValidationEngine`)

Observations must pass all 9 structural and policy checks before becoming attestable:

1. **Schema Check**: Non-null object with valid `valuation` and `timestamp`.
2. **Required Fields**: `observationId` and `assetId` must be non-empty strings.
3. **Timestamp Bound**: `timestamp > 0` and not > 300s in the future.
4. **Freshness Assertions**: `now - timestamp <= MAX_DATA_AGE_SECONDS` (300s / 5 minutes).
5. **Duplicate Detection**: `seenObservationIds` and `seenMetadataHashes` set tracking.
6. **State Transition Validity**: Target request cannot be in `FINALIZED` or `REJECTED` state.
7. **Valuation Range**: `valuation > 0` and `< 1,000,000,000,000`.
8. **Source Authorization**: Source string must not be empty or contain `Disallowed`.
9. **Consistency Verification**: `custodyStatus === "VERIFIED"` and `settlementStatus === "SETTLED"`.

---

## 3. FRESHNESS (`FreshnessEngine`)

Freshness evaluation tracks time-decay across 4 explicit deterministic states:

```
0s ─────── 180s (3m) ─────── 300s (5m) ─────── 900s (15m) ───────> Time
   [ FRESH ]        [ AGING ]        [ STALE ]         [ EXPIRED ]
 (Attestable)     (Attestable)    (Non-Attestable)  (Non-Attestable)
```

* `observedAt`: Observation timestamp (epoch seconds)
* `receivedAt`: Middleware reception timestamp (epoch seconds)
* `maxAge`: Maximum allowed age in seconds (default: 300s)
* `expiresAt`: `observedAt + maxAge`
* `freshnessStatus`:
  - `FRESH`: `age <= 180s`
  - `AGING`: `180s < age <= 300s`
  - `STALE`: `300s < age <= 900s`
  - `EXPIRED`: `age > 900s`

---

## 4. RISK ENGINE (`RiskEngine`)

The `RiskEngine` computes a deterministic composite risk score (`0` to `100`), confidence level (`0.00` to `1.00`), and categorical risk level:

```json
{
  "riskScore": 10,
  "confidence": 0.95,
  "riskLevel": "LOW",
  "reasonCodes": [],
  "status": "PASS"
}
```

* **Risk Levels**:
  - `LOW`: `riskScore <= 20`
  - `MEDIUM`: `20 < riskScore <= 50`
  - `HIGH`: `50 < riskScore <= 80`
  - `CRITICAL`: `riskScore > 80`
* **Evaluated Factors**: Source reliability (+40 if untrusted), data freshness (+10 AGING, +50 STALE, +100 EXPIRED), valuation volatility (+30 if >10% jump), custody status (+40 if unverified), settlement status (+40 if unconfirmed), and offshore jurisdiction (+20).

---

## 5. STATE MACHINE (`MiddlewareStateMachine`)

Orchestrates formal request state transitions with full audit logging:

```
 UNKNOWN
    │
    ▼
 OBSERVED ──> REJECTED / STALE / EXPIRED
    │
    ▼
 VALIDATED ──> REJECTED / STALE / EXPIRED
    │
    ▼
 ATTESTABLE ──> REJECTED / STALE / EXPIRED
    │
    ▼
 ATTESTED (Terminal State)
```

Every transition appends a `StateTransitionLog`:
- `event`: e.g. `"MARK_ATTESTABLE"`
- `condition`: e.g. `"Passed validation & risk < 50"`
- `actor`: e.g. `"RWA_MIDDLEWARE_ENGINE"`
- `timestamp`: Unix epoch seconds
- `reason`: e.g. `"Low risk evaluation"`

Invalid or repeated transitions on terminal states (`ATTESTED`, `REJECTED`) throw `INVALID_STATE_TRANSITION` exceptions.
