# Validation Gate 6 — Cryptographic Integrity & Replay Protection Report

---

## 1. Executive Summary
Validation Gate 6 performs a dedicated cryptographic integrity audit verifying anti-replay protection, nonce consumption, signature binding, and race-condition defense across off-chain webhooks, oracle attestations, and on-chain vault settlement routines.

---

## 2. Cryptographic Replay Protection Matrix

```text
  Nonce N (6001n)   ───► RWAOracleAdapter.submitAttestation() ───► ACCEPTED & USED (usedNonces[N] = true)
        │
        ▼
Replay Nonce N      ───► RWAOracleAdapter.submitAttestation() ───► REVERTED (ReplayedNonce)
        │
        ▼
  Nonce N+1 (6002n) ───► RWAOracleAdapter.submitAttestation() ───► ACCEPTED & USED (usedNonces[N+1] = true)
```

---

## 3. Attack Vector Results & Revert Evidence

| Attack Vector | Replay Payload / Strategy | Security Constraint | Transaction Result | Revert / Error Reason | Status |
|---|---|---|---|---|---|
| **1. Nonce Generation** | Incremental off-chain nonce generation | Nonce unique per attestation | **PASSED** | N/A | **PASS** |
| **2. Nonce Uniqueness** | Submitting unused Nonce $N=6001$ | `usedNonces[N] == false` | **PASSED** | Nonce consumed | **PASS** |
| **3. Nonce Consumption** | Checking state after submission | `usedNonces[N] == true` | **PASSED** | State recorded | **PASS** |
| **4. Replay Nonce N** | Submitting exact same payload with Nonce $N$ | `usedNonces[N] == true` | **REJECTED** | Custom error `ReplayedNonce()` | **PASS** |
| **5. Nonce N+1** | Submitting new payload with Nonce $N+1$ | `usedNonces[N+1] == false` | **PASSED** | Accepted cleanly | **PASS** |
| **6. Attestation Replay** | Replaying valid signed attestation message | Nonce check in `RWAOracleAdapter` | **REJECTED** | Custom error `ReplayedNonce()` | **PASS** |
| **7. Webhook Replay** | Re-delivering signed webhook payload | Idempotency key in API middleware | **REJECTED** | `DUPLICATE_WEBHOOK_EVENT` | **PASS** |
| **8. Settlement Replay** | Second call to `claimShares()` on finalized request | RequestState `Finalized` | **REJECTED** | Custom error `RequestNotClaimable()` | **PASS** |
| **9. Old Payload Replay** | Replaying stale signature and expired nonce | Nonce & freshness checks | **REJECTED** | Custom error `ReplayedNonce()` | **PASS** |
| **10. Race Condition** | Two simultaneous settlement calls | First updates state; second reverts | **REJECTED** | Custom error `RequestNotClaimable()` | **PASS** |

---

## 4. Race Condition & Dual-Settlement Defense Evidence

```text
Deposit Request: REQ-0001 (Attested & State = CLAIMABLE)

Settlement Attempt #1 (Caller: Alice):
  AsyncRWAVault.claimShares("REQ-0001") ───► SUCCESS (1,000 vRWA shares minted; state -> FINALIZED)

Simultaneous Settlement Attempt #2 (Caller: Alice / Attacker):
  AsyncRWAVault.claimShares("REQ-0001") ───► REVERTED (RequestNotClaimable)

Accounting Invariant Result:
  Total Shares Minted = 1,000 vRWA (Zero double minting or unbacked share issuance)
```

---

## 5. Final Status

```text
========================================
FINAL STATUS: PASS
========================================
```
