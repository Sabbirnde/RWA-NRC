# Oracle Adapter Gateway & Verification Specification

> **Frozen Baseline Architecture Segment**:  
> `Signed Attestation ──> Oracle Adapter ──> ERC-7540 Async Vault`

---

## 1. Oracle Adapter Architecture & Responsibilities

`RWAOracleAdapter.sol` serves as the cryptographic gateway connecting off-chain RWA Middleware attestations to the on-chain `AsyncRWAVault.sol`:

```
┌─────────────────────────────────────────────────────────────┐
│                 OFF-CHAIN RWA MIDDLEWARE                    │
│  Generates EIP-712 Signature with ATTESTER_PRIVATE_KEY      │
└──────────────────────────────┬──────────────────────────────┘
                               │ submitAttestation(params, sig)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                   RWA ORACLE ADAPTER                        │
│  1. Check Nonce (`!usedNonces[nonce]`)                       │
│  2. Check Timestamp (`block.timestamp <= timestamp + 15m`)  │
│  3. Verify EIP-712 Signature (`ECDSA.recover`)              │
│  4. Assert `recoveredSigner == attesterSigner`              │
│  5. Assert `!revokedSigners[recoveredSigner]`               │
│  6. Mark Nonce Used (`usedNonces[nonce] = true`)            │
│  7. Update Asset Registry                                   │
└──────────────────────────────┬──────────────────────────────┘
                               │ onAttestationSettled(requestId, nav)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 ERC-7540 ASYNC VAULT                        │
│  Transitions Request: PENDING ──> CLAIMABLE                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. On-Chain Verification Pipeline (10-Step Check)

1. **Receive Attestation**: External relayer or middleware calls `submitAttestation(params, signature)`.
2. **Replay Check**: Asserts `!usedNonces[params.nonce]`. (Reverts `ReplayedNonce()`).
3. **Staleness Check**: Asserts `block.timestamp <= params.timestamp + maxDataAge`. (Reverts `StaleAttestation()`).
4. **Struct Hashing**: Computes EIP-712 `structHash` using `ATTESTATION_TYPEHASH`.
5. **EIP-712 Digest**: Computes domain-separated digest `_hashTypedDataV4(structHash)`.
6. **Signature Recovery**: Recovers signer address via `ECDSA.recover(hash, signature)`.
7. **Key Revocation Check**: Asserts `!revokedSigners[recoveredSigner]`. (Reverts `RevokedSigner()`).
8. **Signer Authorization Check**: Asserts `recoveredSigner == attesterSigner`. (Reverts `UnauthorizedSigner()`).
9. **State Storage**: Marks `usedNonces[params.nonce] = true` and updates `RWAAssetRegistry`.
10. **Vault Forwarding**: Invokes `IAsyncVaultCallback(vault).onAttestationSettled(params.requestId, params.nav)`.

---

## 3. Custom Solidity Errors & Events

* `error UnauthorizedSigner()`
* `error RevokedSigner()`
* `error ReplayedNonce()`
* `error StaleAttestation()`
* `error VaultNotConfigured()`

```solidity
event AttestationAccepted(string indexed requestId, string indexed assetId, string state, uint256 nav, uint256 yieldRate, uint256 timestamp);
event AttestationRejected(string indexed requestId, string indexed assetId, string reason);
event RWAStateUpdated(string indexed assetId, uint256 nav, uint256 yieldRate, bytes32 riskStatus);
event SignerUpdated(address indexed newSigner);
event SignerRevoked(address indexed revokedSigner);
```
