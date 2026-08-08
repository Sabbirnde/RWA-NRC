# Threat Model & Risk Analysis

This document identifies potential attack vectors, threat actors, and protocol mitigation mechanisms.

---

## 🎯 Threat Analysis & Mitigations

| Threat Vector | Potential Impact | Protocol Mitigation Strategy |
|---|---|---|
| **Stale Web Reference Data** | Vault settles on outdated NAV / yield values | `ValidationEngine` checks `MAX_DATA_AGE_SECONDS` (<5m); `RWAOracleAdapter` rejects timestamps older than `maxDataAge` (15m). |
| **Replay Attack on Attestations** | Attestation resubmitted to claim shares twice | `RWAOracleAdapter.sol` maintains `usedNonces[nonce]` mapping. Reused nonces revert `ReplayedNonce()`. |
| **Unauthorized Attestation Signing** | Malicious actor mints fake vault shares | `RWAOracleAdapter.sol` recovers signer via EIP-712 `ECDSA.recover` and asserts `recoveredSigner == attesterSigner`. |
| **Premature Share Minting** | Attacker claims shares before settlement | `AsyncRWAVault.sol` asserts `claimableShares > 0`. Pending state yields strictly 0 shares. |
| **Front-Running / Double Sale in Claim Market** | Seller sells claim to multiple buyers | `ClaimMarket.sol` deactivates listing (`listing.active = false`) BEFORE transferring collateral/claim, guarded by `nonReentrant`. |
| **Arbitrary State Jump Attack** | Attacker forces state to `FINALIZED` directly | `AsyncRWAVault.sol` enforces explicit transition function `_transitionState` and `isValidStateTransition`. |
| **Contract Emergency Exploits** | Flash loan or protocol anomaly | Emergency pause (`pause()`) halts new deposit & redemption requests. |
