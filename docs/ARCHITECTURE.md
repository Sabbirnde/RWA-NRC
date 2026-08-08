# Architecture Specification

## Overview

Traditional ERC-4626 static vaults assume atomic and synchronous deposit/redemption execution:
`Deposit -> Immediate Shares` / `Redeem -> Immediate Assets`.

This model fails for tokenized Real-World Assets (RWAs) due to asynchronous banking settlement, delayed NAV calculations, custody checks, and external data dependencies.

The **Asynchronous RWA Vault Infrastructure** bridges this gap using three modular layers:

```
[Layer 1: RWA Middleware] ---> [Layer 2: ERC-7540 Async Vault] ---> [Layer 3: Claim Market]
```

---

## Layer 1: RWA Middleware
- Ingests reference data via Firecrawl and Mock RWA APIs.
- Normalizes reference attributes (NAV, yield rate, custody status, settlement status).
- Enforces data freshness thresholds (`MAX_DATA_AGE`).
- Applies a deterministic risk engine (`PASS` / `FAIL`).
- Signs EIP-712 typed structured data attestations.

## Layer 2: ERC-7540 Asynchronous Vault (`AsyncRWAVault.sol`)
- Enforces strict separation between pending requests and claimable balances.
- **Premature Minting Protection**: During `PENDING` state, `claimableShares` is strictly `0`.
- Only authorized EIP-712 attestations submitted through `RWAOracleAdapter.sol` can transition requests to `CLAIMABLE`.

## Layer 3: Claim Marketplace (`ClaimMarket.sol`)
- Addresses the temporal liquidity gap for depositors.
- Depositors list pending claim tokens at a fixed discount (e.g. 2% discount).
- Buyers purchase claims with immediate payment, transferring claim ownership and providing **T+0 liquidity** to the depositor while the underlying asset completes settlement.
