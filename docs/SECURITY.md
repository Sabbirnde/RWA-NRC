# Protocol Security Specifications & Invariants

This document details the core security invariants, access controls, and automated test coverage across the smart contract ecosystem and middleware services.

---

## 🔒 5 Fundamental Security Invariants

1. **Premature Minting Protection**:
   `req.state == PENDING ==> req.claimableShares == 0`
   Vault shares (`vRWA`) are never minted until an authorized EIP-712 attestation clears off-chain validation and settlement.

2. **EIP-712 Replay Protection**:
   `RWAOracleAdapter.sol` maintains an on-chain `usedNonces[nonce]` mapping. Reused nonces revert with custom error `ReplayedNonce()`.

3. **Data Freshness Requirement**:
   Off-chain `ValidationEngine` enforces `MAX_DATA_AGE_SECONDS` (default: 300s). On-chain `RWAOracleAdapter` asserts `block.timestamp <= timestamp + maxDataAge` (15m threshold). Stale updates revert `StaleAttestation()`.

4. **Fail-Closed Safety Principle**:
   When external reference data fails schema checks, custody verification, or freshness thresholds, settlement is **delayed**, never forced. Delay is considered a successful security outcome.

5. **Reentrancy & Access Control**:
   All state-changing functions use OpenZeppelin's `ReentrancyGuard` (`nonReentrant`), `SafeERC20`, and explicit access control modifiers (`onlyOracle`, `onlyOwner`).

---

## 🧪 18-Case Automated Test Suite Coverage

The protocol is backed by an automated 18-case test suite (`packages/contracts/test/AsyncRWAVault.test.ts`):

1. **Premature Minting Protection**: Shares balance is `0n` during `PENDING`.
2. **Attestation Finalization**: Valid attestation mints shares to claim owner.
3. **Unauthorized Signer Rejection**: Reverts `UnauthorizedSigner()`.
4. **Direct Oracle Callback Guard**: Direct calls to `vault.onAttestationSettled` revert `UnauthorizedOracle()`.
5. **Nonce Tracking Replay Protection**: Reused nonces revert `ReplayedNonce()`.
6. **Stale Attestation Rejection**: Expired timestamps revert `StaleAttestation()`.
7. **Rejected Attestation Handling**: `REJECTED` state prevents claimability.
8. **Invalid Request ID Handling**: Claiming non-existent requests reverts `RequestNotClaimable()`.
9. **T+0 Claim Market Purchase**: Purchase transfers claim ownership and USDC.
10. **Self-Purchase Prevention**: Sellers buying their own claim revert `CannotBuySelf()`.
11. **Non-Owner Listing Prevention**: Non-owners listing claims revert `NotClaimOwner()`.
12. **Settled Claim Listing Prevention**: Listing settled claims reverts `ClaimAlreadySettled()`.
13. **Emergency Pause**: `vault.pause()` blocks deposit requests (`whenNotPaused`).
14. **Emergency Unpause**: `vault.unpause()` restores normal vault operations.
15. **State Transition Integrity**: Direct `Pending -> Finalized` attempts revert `RequestNotClaimable()`.
16. **Double Claim Deposit Guard**: Reclaims revert `RequestNotClaimable()`.
17. **Double Claim Redemption Guard**: Re-redeeming reverts `RequestNotClaimable()`.
18. **Finalized State Regression Guard**: Re-submitting attestations for `Finalized` requests is blocked.
