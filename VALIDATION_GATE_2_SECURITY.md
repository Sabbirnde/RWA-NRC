# Validation Gate 2 — Smart Contract Settlement Security Report

---

## 1. Scope & Objective
Validation Gate 2 performs dedicated security testing of the smart-contract settlement mechanism, focusing exclusively on preventing unauthorized, premature, or forged settlement share minting.

---

## 2. Adversarial Attack Matrix

### Attack 1: Mint shares before fulfillment
- **Attack Vector**: Caller invokes `AsyncRWAVault.claimShares("REQ-0001")` while request is in `PENDING` state.
- **Expected Result**: Revert with `RequestNotClaimable()`.
- **Actual Result**: Transaction reverted with custom error `RequestNotClaimable()`.
- **Status**: **PASS**

---

### Attack 2: Settle request without attestation
- **Attack Vector**: Caller attempts to claim shares without `RWAOracleAdapter.submitAttestation()` being executed.
- **Expected Result**: Revert with `RequestNotClaimable()`.
- **Actual Result**: Transaction reverted with custom error `RequestNotClaimable()`.
- **Status**: **PASS**

---

### Attack 3: Call fulfillment directly
- **Attack Vector**: Unauthorized non-oracle account calls `AsyncRWAVault.onAttestationSettled()`.
- **Expected Result**: Revert with `UnauthorizedOracle()`.
- **Actual Result**: Transaction reverted with custom error `UnauthorizedOracle()`.
- **Status**: **PASS**

---

### Attack 4: Use unauthorized account for admin controls
- **Attack Vector**: Non-owner account calls `RWAOracleAdapter.setAuthorizedSigner()`.
- **Expected Result**: Revert with OpenZeppelin `OwnableUnauthorizedAccount()`.
- **Actual Result**: Transaction reverted with OpenZeppelin `OwnableUnauthorizedAccount()`.
- **Status**: **PASS**

---

### Attack 5: Use invalid request ID
- **Attack Vector**: Caller attempts to claim shares for non-existent request `REQ-NONEXISTENT-9999`.
- **Expected Result**: Revert with `RequestNotClaimable()`.
- **Actual Result**: Transaction reverted with custom error `RequestNotClaimable()`.
- **Status**: **PASS**

---

### Attack 6: Use another user's request
- **Attack Vector**: Alice attempts to claim shares on Bob's settled request `REQ-0001`.
- **Expected Result**: Revert with `NotClaimOwner()`.
- **Actual Result**: Transaction reverted with custom error `NotClaimOwner()`.
- **Status**: **PASS**

---

### Attack 7: Reuse an old settlement payload (attestation replay)
- **Attack Vector**: Submitting the exact same EIP-712 attestation payload and signature twice.
- **Expected Result**: Revert with `ReplayedNonce()`.
- **Actual Result**: Transaction reverted with custom error `ReplayedNonce()`.
- **Status**: **PASS**

---

### Attack 8: Execute settlement twice
- **Attack Vector**: Rightful claim owner calls `claimShares()` a second time on a `FINALIZED` request.
- **Expected Result**: Revert with `RequestNotClaimable()`.
- **Actual Result**: Transaction reverted with custom error `RequestNotClaimable()`.
- **Status**: **PASS**

---

### Attack 9: Modify settlement parameters
- **Attack Vector**: Attacker tampers NAV value in EIP-712 payload after attester signed message.
- **Expected Result**: Revert with `UnauthorizedSigner()`.
- **Actual Result**: Signature verification failed; transaction reverted with custom error `UnauthorizedSigner()`.
- **Status**: **PASS**

---

### Attack 10: Bypass intended middleware/oracle path
- **Attack Vector**: Direct invocation of internal `_mint` or forced state mutation on `AsyncRWAVault.sol`.
- **Expected Result**: Revert with `RequestNotClaimable()`.
- **Actual Result**: Inaccessible internal function; direct claim reverted with `RequestNotClaimable()`.
- **Status**: **PASS**

---

## 3. Security Boundary Assertions & Accounting Integrity

- **Access Control**: Enforced across all state mutations (`onlyOwner`, `onlyOracle`, `whenNotPaused`).
- **Request Ownership**: Bound strictly to `ClaimRegistry` owner mapping.
- **Attestation Requirement**: EIP-712 domain-bound signature required prior to `CLAIMABLE` transition.
- **Replay Protection**: Cryptographic nonce recorded on-chain in `RWAOracleAdapter.sol`.
- **Accounting Integrity**: Total shares minted equal exact attestation NAV valuation; 0 unbacked shares.

---

## 4. Final Status

```text
========================================
FINAL STATUS: PASS
========================================
```
