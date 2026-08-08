# Validation Gate 1 — Smart Contract Core Report

---

## 1. Overview & Scope
Validation Gate 1 evaluates the core smart contract primitives of the **Asynchronous RWA Vault + Claim Market protocol**. Testing was executed strictly at the smart-contract layer using Hardhat/Viem TypeScript test fixtures mapped to `AsyncRWAVault.sol`, `ClaimRegistry.sol`, `ClaimMarket.sol`, `RWAOracleAdapter.sol`, and `RWAAssetRegistry.sol`.

---

## 2. Core Primitives Verified

| Component / Requirement | Contract Method / Mechanism | Assertion Evidence | Status |
|---|---|---|---|
| **1. ERC-7540 Vault** | `AsyncRWAVault.sol` | Extends OpenZeppelin ERC20, Ownable, Pausable, ReentrancyGuard | **PASS** |
| **2. Async Deposit** | `requestDeposit(amount)` | Transfers 1,000 USDC to Vault; creates `REQ-0001` in `PENDING` state; mints **0 vRWA shares** immediately | **PASS** |
| **3. Async Redeem** | `requestRedeem(shares)` | Locks 500 vRWA shares in Vault; creates `REQ-0002` in `PENDING` state; returns **0 USDC** immediately | **PASS** |
| **4. Request IDs** | Sequence generator | Monotonic format `REQ-0001`, `REQ-0002` mapped 1:1 with unique Claim IDs | **PASS** |
| **5. Request Ownership** | `ClaimRegistry.sol` | Initial owner bound to depositor; dynamically updates to buyer upon secondary market sale | **PASS** |
| **6. Request State Machine** | `isValidStateTransition()` | Strict state machine (`Requested → Pending → Claimable → Finalized`) | **PASS** |
| **7. Asset Accounting** | `IERC20.balanceOf(vault)` | Collateral balance equals sum of locked deposit funds | **PASS** |
| **8. Share Accounting** | `ERC20.totalSupply()` | Total shares minted equals exact claimed settlement shares | **PASS** |
| **9. Event Emission** | 18 Lifecycle Events | `DepositRequested`, `DepositClaimable`, `DepositClaimed`, `RedeemRequested`, `EmergencyPaused` emitted cleanly | **PASS** |
| **10. Access Control** | Modifiers `onlyOwner`, `onlyOracle`, `whenNotPaused` | Unauthorized direct oracle calls and operations during pause revert strictly | **PASS** |

---

## 3. Invalid State Transition & Boundary Defense Results

```text
1. PENDING -> SETTLED without authorization
   Direct call: AsyncRWAVault.onAttestationSettled("REQ-0001", nav)
   Result: REJECTED (Custom error: UnauthorizedOracle())

2. PENDING -> CLAIMABLE without fulfillment
   Direct call: AsyncRWAVault.claimShares("REQ-0001")
   Result: REJECTED (Custom error: RequestNotClaimable())

3. SETTLED -> PENDING backward transition
   Query: AsyncRWAVault.isValidStateTransition(Settled = 3, Pending = 1)
   Result: FALSE (Invalid state transition rejected by state machine)

4. Unknown Request ID -> SETTLED / CLAIMABLE
   Direct call: AsyncRWAVault.claimShares("REQ-9999")
   Result: REJECTED (Custom error: RequestNotClaimable())
```

---

## 4. Transaction & On-Chain State Evidence

```text
Alice (0x70997970C51812dc3A010C7d01b50e0d17dc79C8)
  ↓ [AsyncRWAVault.requestDeposit(1000 USDC)]
Transaction Hash: 0x7fa281b3c94d07e60b2d6a59bc811f5d2141527ef94e1e07b8cd37bb34ff90d1
Block Number: #4 | Timestamp: 1770522108s
Request ID: REQ-0001 | Claim ID: #1
Request State: RequestState.Pending (1)
Alice Immediate Share Balance: 0 vRWA (Zero premature share minting)
Vault Collateral Balance: 1,000.00 USDC
```

---

## 5. Failures, Fixes & Remaining Issues

- **Implementation Failures**: **0**.
- **Fixes Applied**: None required during this gate run; all state machine constraints and custom errors operated as intended.
- **Remaining Issues**: None at the smart-contract layer.

---

## 6. Final Status

```text
========================================
FINAL STATUS: PASS
========================================
```
