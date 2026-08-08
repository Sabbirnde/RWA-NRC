# Synchronous Vault Reference Baseline Model

This document establishes the conventional synchronous vault reference baseline (e.g., standard ERC-4626 atomic deposit flow) used as an experimental control for validating Research Hypothesis H1.

---

## 1. Baseline Assumptions

1. **Atomic Off-Chain Liquidity & Execution**: The vault assumes that underlying asset valuation (NAV) and off-chain custody settlement occur instantaneously within the same block transaction execution ($T_0$).
2. **Instantaneous Valuation**: Share pricing is determined immediately at block execution time based on the vault's on-chain asset balance ($1.00\text{ USD per share}$).
3. **No Intermediate State**: No pending or unverified state exists between deposit asset transfer and share issuance.

---

## 2. Baseline State Transition Flow

```text
User
 ↓
Deposit 1,000 USDC (T0)
 ↓
Vault calculates shares (1,000 shares @ $1.00/share)
 ↓
Shares immediately issued (T0)
```

| Phase | On-Chain Function Call | User USDC Balance | Vault USDC Balance | User Share Balance | Request State |
|---|---|---|---|---|---|
| **Pre-Deposit** | Initial state | `1,000 USDC` | `0 USDC` | `0 shares` | N/A |
| **Deposit Transaction ($T_0$)** | `deposit(1000 USDC)` | `0 USDC` | `1,000 USDC` | **`1,000 shares`** | **Atomic Settlement** |

---

## 3. Baseline Timing

$$\text{Time of Deposit } (T_{\text{deposit}}) = T_0$$
$$\text{Time of Share Issuance } (T_{\text{issuance}}) = T_0$$

$$\text{Settlement Latency } (\Delta T) = T_{\text{issuance}} - T_{\text{deposit}} = 0 \text{ seconds}$$

---

## 4. Baseline Accounting

- **Deposit Amount**: `1,000 USDC`
- **Initial Share Price**: `1.00 USD / share`
- **Calculated Shares**: $\frac{1000\text{ USDC}}{1.00\text{ USD/share}} = 1000\text{ vRWA Shares}$
- **Accounting Invariant**: $100\% \text{ of shares minted instantly at } T_0$ simultaneously with asset transfer.

---

## 5. What Proposed Asynchronous Architecture Must Demonstrate Differently

| Dimension | Conventional Synchronous Baseline | Proposed Asynchronous Architecture (ERC-7540 + Middleware) |
|---|---|---|
| **Deposit Execution** | Atomic: Asset transfer & share minting in 1 tx ($T_0$) | Two-Phase: Request created at $T_0$, shares minted at $T_{\text{settle}} > T_0$ |
| **Pending State** | None (0 pending duration) | Explicit pending request state (`RequestState.Pending`, `claimableShares = 0`) |
| **Premature Share Issuance** | Shares minted immediately before off-chain RWA settlement | **Zero shares issued** at $T_0$; minting strictly deferred until attestation |
| **External Verification** | Assumed atomic or ignored at protocol layer | Explicit off-chain middleware verification (freshness, risk, EIP-712 attestation) |
| **Liquidity Mismatch Handling** | User locked until settlement or forced into illiquidity | **T+0 Claim Market** enables secondary liquidity during asynchronous gap |
