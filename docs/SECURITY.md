# Security Design & Invariants

## Core Invariants

1. **Premature Minting Protection**:
   `pendingBalance != 0 ==> claimableShares == 0`
   Vault shares are never minted until an authorized EIP-712 attestation clears off-chain validation and settlement.

2. **Replay Protection**:
   `RWAOracleAdapter` maintains a `usedNonces[nonce]` mapping. Reused nonces revert with `ReplayedNonce()`.

3. **Data Freshness Requirement**:
   Attestations with `block.timestamp > timestamp + maxDataAge` revert with `StaleAttestation()`.

4. **Fail-Closed Safety Principle**:
   When external reference data fails validation, custody checks, or freshness thresholds, settlement is **delayed**, never forced.

5. **Reentrancy Protection**:
   All state-changing functions in `AsyncRWAVault.sol` and `ClaimMarket.sol` utilize OpenZeppelin's `ReentrancyGuard`.
