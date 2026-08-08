# System Architecture Specification

## Overview

Traditional ERC-4626 static vaults assume atomic and synchronous execution:
`Deposit -> Immediate Shares` / `Redeem -> Immediate Assets`.

This model fails for tokenized Real-World Assets (RWAs) due to asynchronous banking settlement (T+1 to T+3), delayed NAV calculations, legal custody verification, and external data dependencies.

The **Asynchronous RWA Vault Infrastructure** bridges this gap across three core decoupled layers:

```
[Layer 1: RWA Middleware] ─── (EIP-712 Attestation) ───> [Layer 2: ERC-7540 Async Vault] ─── (Claim Transfer) ───> [Layer 3: Claim Market]
```

---

## 🏛 Layer Breakdown

### Layer 1: Real-World State Middleware (`artifacts/api-server`)
- **Ingestion**: Fetches reference data via `FirecrawlProvider` (web extraction) and `MockRWAProvider`.
- **Normalization**: Formats external metrics into standard `RWAAssetState` structures.
- **Validation Engine**: Evaluates a 10-point checklist (Schema, Asset ID, Timestamp, Freshness, State Transitions, NAV Sanity, Issuer, Custody, Settlement, Nonce).
- **Freshness Engine**: Configurable `MAX_DATA_AGE_SECONDS` (default: 300s / 5m). Rejects stale data.
- **Risk Engine**: Evaluates custody and credit posture, outputting deterministic `PASS`/`FAIL` statuses and reason codes (`STALE_DATA`, `CUSTODY_NOT_VERIFIED`, etc.).
- **Attestation Service**: Signs EIP-712 typed structured data (`RWA-OracleAdapter`, `1.0.0`) using `ATTESTER_PRIVATE_KEY`.

### Layer 2: ERC-7540 Asynchronous Vault (`AsyncRWAVault.sol` & `RWAOracleAdapter.sol`)
- **State Machine**: Enforces explicit state flow (`Requested -> Pending -> Verified -> Settled -> Claimable -> Finalized`). Rejects arbitrary jumps.
- **Premature Minting Protection**: While a request is in `PENDING`, `claimableShares` is strictly `0`. No shares exist until settlement attestation passes.
- **Oracle Gateway**: `RWAOracleAdapter.sol` verifies attester signatures, nonces, timestamps, and asset IDs before invoking vault callbacks (`onAttestationSettled`).
- **Emergency Protection**: Inherits OpenZeppelin `Pausable` for owner emergency pausing (`pause()` / `unpause()`).

### Layer 3: Fixed-Price Claim Marketplace (`ClaimMarket.sol` & `ClaimRegistry.sol`)
- **Liquidity Bridge**: Solves the T+2 settlement waiting period by enabling depositors to sell pending claims at a fixed discount (e.g. 2%).
- **Immediate Cashflow**: Buyers purchase claims for USDC, providing depositors **T+0 instant liquidity**.
- **Settlement Transfer**: Claim ownership transfers on-chain in `ClaimRegistry.sol`. When settlement completes, `AsyncRWAVault.sol` mints final shares directly to the buyer.
