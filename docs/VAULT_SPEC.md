# ERC-7540 Asynchronous Vault Specification & Accounting Invariants

> **Frozen Baseline Architecture Segment**:  
> `Oracle Adapter ──> ERC-7540 Async Vault ──> Claim Registry`

---

## 1. ERC-7540 Compatibility & Verification Matrix

| ERC-7540 Requirement | Smart Contract Implementation | Security Test Case | Test Result |
|---|---|---|---|
| **Async Deposit Request** | `requestDeposit(uint256 amount)` | `AsyncRWAVault.test.ts`: Premature Minting Protection | ✅ **PASS** |
| **Async Redeem Request** | `requestRedeem(uint256 shares)` | `AsyncRWAVault.test.ts`: Double claimAssets attempt | ✅ **PASS** |
| **Pending Accounting Separation** | `req.claimableShares == 0` in `PENDING` | `AsyncRWAVault.test.ts`: Invariant check | ✅ **PASS** |
| **Settlement Callback** | `onAttestationSettled(requestId, nav)` | `AsyncRWAVault.test.ts`: Finalize deposit & mint shares | ✅ **PASS** |
| **Claiming Shares** | `claimShares(string requestId)` | `AsyncRWAVault.test.ts`: Finalize deposit | ✅ **PASS** |
| **Claiming Assets** | `claimAssets(string requestId)` | `AsyncRWAVault.test.ts`: Redeem assets payout | ✅ **PASS** |
| **Claim Entitlement Transfer** | `IClaimRegistry.getClaimOwner(claimId)` | `AsyncRWAVault.test.ts`: T+0 claim purchase & transfer | ✅ **PASS** |
| **Emergency Pause** | `Pausable._pause()` / `_unpause()` | `AsyncRWAVault.test.ts`: Emergency Pause & Recovery | ✅ **PASS** |

---

## 2. Proven Accounting Invariants

1. **Premature Minting Protection Invariant**:
   `req.state == RequestState.Pending ==> req.claimableShares == 0`
   *Proof*: Assets transferred to vault on `requestDeposit()`, but zero `vRWA` shares are minted until `onAttestationSettled()` transitions state to `Claimable`.

2. **No Double Finalization Invariant**:
   `req.state == RequestState.Finalized ==> claimShares() / claimAssets() REVERTS`
   *Proof*: Invoking `claimShares()` on a `Finalized` request triggers `_transitionState(req, RequestState.Finalized)` which reverts with `InvalidStateTransition()`.

3. **No Unbacked Value Creation Invariant**:
   `Total Minted vRWA <= Locked Underlying Assets + Settlement Obligations`
   *Proof*: `_mint(recipient, sharesToMint)` is called strictly after `requestDeposit()` locks assets and `onAttestationSettled()` verifies off-chain custody & NAV.

4. **Claim Entitlement Integrity Invariant**:
   `claimShares()` mints shares to `claimRegistry.getClaimOwner(claimId)` if traded on `ClaimMarket.sol`.

---

## 3. Formal State Transitions Table

| Current State | Triggering Event | Prerequisite Condition | Next State | Authorized Actor | Revert Code on Violation |
|---|---|---|---|---|---|
| `None` | `requestDeposit` | `amount > 0` & `!paused` | `Pending` | Any Depositor | `InvalidAmount` / `EnforcedPause` |
| `None` | `requestRedeem` | `shares > 0` & `!paused` | `Pending` | Any Shareholder | `InvalidAmount` / `EnforcedPause` |
| `Pending` | `onAttestationSettled` | `msg.sender == oracleAdapter` | `Claimable` | `RWAOracleAdapter` | `UnauthorizedOracle` |
| `Pending` | `onAttestationRejected` | `msg.sender == oracleAdapter` | `Rejected` | `RWAOracleAdapter` | `UnauthorizedOracle` |
| `Claimable` | `claimShares` | `msg.sender == claimOwner` | `Finalized` | Claim Owner | `RequestNotClaimable` / `AlreadyClaimed` |
| `Claimable` | `claimAssets` | `msg.sender == req.owner` | `Finalized` | Request Owner | `RequestNotClaimable` / `AlreadyClaimed` |
| `Finalized` | Any Call | N/A | Terminal | N/A | `InvalidStateTransition` |
| `Rejected` | Any Call | N/A | Terminal | N/A | `InvalidStateTransition` |

---

## 4. Security Controls & Emergency Recovery

- **Oracle Callback Authorization**: `onlyOracle` modifier asserts `msg.sender == oracleAdapter`. External calls from unauthorized addresses revert `UnauthorizedOracle()`.
- **Reentrancy Protection**: OpenZeppelin `ReentrancyGuard` (`nonReentrant`) on `requestDeposit`, `requestRedeem`, `claimShares`, and `claimAssets`.
- **Emergency Circuit Breaker**: Owner can invoke `pause()` to freeze new deposit and redemption requests during market anomalies or oracle failures.
