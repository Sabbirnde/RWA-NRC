# Protocol Accounting Model & Invariant Specifications

This document defines the formal mathematical accounting model and conservation invariants enforced by `AsyncRWAVault.sol`, `ClaimRegistry.sol`, and the RWA Middleware.

---

## 📐 Fundamental Conservation Invariants

```
Total Collateral Assets (Vault + External Custody)
       = Pending Assets + Claimable Assets + Finalized Assets
```

```
Total Vault Shares Supply (vRWA)
       = Finalized Minted Shares (In User Wallets)
```

```
Outstanding Claims Count
       = Total Pending Requests + Total Claimable Requests
```

---

## 📊 Accounting State Lane Definitions

| Accounting Lane | Contract Storage State | Description | Double-Counting Protection |
|---|---|---|---|
| **Deposited Assets** | `IERC20(asset).balanceOf(vault)` | Raw collateral transferred into the vault contract upon `requestDeposit()`. | Assets are locked immediately; no shares are minted until settlement. |
| **Pending Assets** | `RequestState.Pending` / `RequestState.Verified` | Assets committed to an un-attested deposit request (`claimableShares == 0`). | Excluded from `totalSupply()` and user share balances. |
| **Claimable Assets** | `RequestState.Claimable` | Assets approved for minting via EIP-712 attestation (`claimableShares > 0`). | Value is locked to `requestId`. Shares are not minted until `claimShares()` is invoked. |
| **Finalized Assets** | `RequestState.Finalized` | Assets backed 1:1 by minted `vRWA` vault shares held by final claim owners. | Represented directly in `vRWA.balanceOf(owner)`. |
| **Vault Shares (vRWA)** | `ERC20.totalSupply()` | ERC-20 token shares issued upon `claimShares()`. | `totalSupply()` strictly reflects finalized claims (`Pending` and `Claimable` carry 0 shares). |
| **Outstanding Claims** | `ClaimRegistry._claims[claimId]` | Tokenized rights (`ClaimStatus.Active` or `Listed`) backing pending requests. | 1:1 mapped to `requestId`. Settlement automatically marks claim `Settled`. |

---

## 🔁 Mathematical State Transitions

```
[User Deposits Asset]
       │
       ▼
1. REQUESTED / PENDING
   • Vault Asset Balance: +1,000 USDC
   • Pending Assets:       +1,000 USDC
   • Claimable Shares:     0 vRWA
   • Total Supply (vRWA):  0 vRWA
   • Outstanding Claims:   1 (Active)
       │
       ▼  (Attestation Passed: Oracle -> onAttestationSettled)
2. CLAIMABLE
   • Pending Assets:       -1,000 USDC
   • Claimable Assets:     +1,000 USDC
   • Claimable Shares:     +1,000 vRWA (Entitlement calculated via NAV)
   • Total Supply (vRWA):  0 vRWA (Not minted yet!)
       │
       ▼  (User / Claim Owner calls claimShares)
3. FINALIZED
   • Claimable Assets:     -1,000 USDC
   • Finalized Assets:     +1,000 USDC
   • Claimable Shares:     0 vRWA (Zeroed out!)
   • Total Supply (vRWA):  +1,000 vRWA (Minted to claim owner)
   • Outstanding Claims:   0 (Settled)
```

---

## 🔒 Anti-Double-Counting Security Guarantees

1. **Premature Minting Violation Guard**:
   - `AsyncRWAVault.sol:L226` explicitly verifies `req.claimableShares > 0` before calling `_mint()`. Pending requests cannot mint shares.

2. **Reentrancy & State Zeroing**:
   - Before `_mint()` or `safeTransfer()` is invoked in `claimShares()` / `claimAssets()`, `_requests[requestId].state` is updated to `Finalized` and `claimableShares` / `claimableAssets` is zeroed out (`req.claimableShares = 0`).

3. **Claim Market Transfer Integrity**:
   - Purchasing a claim on `ClaimMarket.sol` transfers claim ownership in `ClaimRegistry`. When `claimShares()` is executed, `AsyncRWAVault.sol:L230` reads `claimRegistry.getClaimOwner(claimId)` and mints shares **exclusively** to the current owner, preventing double settlement or duplicate payout.
