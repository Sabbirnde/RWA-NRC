# Gate 7 — Hypothesis H1 Research Comparison Report

This document records the empirical comparison between the conventional synchronous vault reference baseline and the proposed asynchronous RWA vault architecture (ERC-7540 + RWA Middleware) for Research Hypothesis H1.

---

## 1. Empirical Property Comparison Table

| Property | Synchronous Baseline (Control) | Proposed Asynchronous Architecture (Tested PoC) |
|---|---|---|
| **Deposit** | Immediate | Request (`requestDeposit()` creates `REQ-XXXX`) |
| **Settlement** | Immediate ($T_0$) | Asynchronous ($T_{\text{settle}} > T_0$) |
| **Pending state** | Not central (0 pending state representation) | Explicit (`RequestState.Pending`, `claimableShares = 0`) |
| **External verification** | Outside settlement lifecycle | Required (Middleware normalization, freshness, risk check) |
| **Attestation** | Not required in baseline | Required (EIP-712 cryptographic signature verified on-chain) |
| **Claimable state** | Not central | Explicit (`RequestState.Claimable`, `claimableShares > 0`) |
| **Final settlement** | Immediate ($T_0$) | Separate step (`vault.claimShares()` execution) |
| **Share issuance** | Immediate ($T_0$) | After settlement (Minting strictly deferred to `claimShares()`) |
| **Failure before settlement** | Limited state representation (Tx revert only) | Explicit (`RequestState.Rejected` or `STALE` holding state) |
| **Audit trail** | Deposit-focused (`Transfer` / `Deposit` events) | Request/state/event-focused (18 lifecycle events + JSON audit logs) |

---

## 2. Structured Research Analysis

### Question 1: What does the baseline assume?
The synchronous baseline assumes that off-chain liquidity transfer, custody verification, and real-world asset valuation (NAV) occur instantaneously within the same block execution ($T_0$). It assumes that shares can be minted immediately upon collateral deposit without exposing the vault to uncollateralized or stale asset risk.

### Question 2: What does the proposed architecture add?
The proposed architecture adds:
1. An **explicit two-phase asynchronous request lifecycle** (`Pending → Claimable → Finalized`) compliant with ERC-7540.
2. An **off-chain RWA Middleware pipeline** (data normalization, 15-rule schema validation, freshness threshold checking, and conservative risk scoring).
3. **EIP-712 cryptographic attestation gating**, requiring authorized off-chain signatures before an asynchronous request can transition to `Claimable`.
4. **Deferred share minting**, ensuring `balanceOf(depositor) == 0` until final settlement is explicitly executed.

### Question 3: What behavior was experimentally demonstrated?
- **Zero Premature Share Issuance**: Verified on-chain that `requestDeposit()` creates a `PENDING` request with 0 shares minted to the depositor (`sharesIssuedAtRequestCreation = 0`, `Premature Issuance Rate = 0%`).
- **Attestation Enforcement**: Verified that submitting a valid EIP-712 attestation transitions the request to `CLAIMABLE` without prematurely minting shares.
- **Explicit Final Settlement**: Verified that shares are minted strictly when `claimShares()` is executed on a `CLAIMABLE` request.
- **Fail-Closed Stale Data Protection**: Verified that stale RWA data (age 37m > threshold 10m) causes middleware validation to fail, blocks attestation generation, reverts on-chain submission (`StaleAttestation`), and leaves the request safely in `PENDING` state with 0 shares issued.
- **Temporal Separation**: Verified distinct timestamps ($T_0 \neq T_5$) and block numbers between request creation and final settlement.

### Question 4: What behavior was not demonstrated?
- **Commercial Bank/Oracle Network Integration**: The experiment did not test production banking rails or decentralized chainlink/MPC oracle networks (mock and Firecrawl scraped data were used).
- **Multi-Year Asset Maturity Lifecycle**: Long-term asset maturity scenarios stretching over months/years were not tested in the PoC environment.
- **Legal Entity Enforcement**: The experiment did not demonstrate legal off-chain bankruptcy remote bankruptcy asset recovery.

### Question 5: What limitations remain?
1. **Attester Signer Centralization**: The attestation signer key is currently managed by a centralized off-chain middleware service (`attesterSigner`), representing a single point of attestation authority unless expanded to an M-of-N threshold multisig.
2. **Oracle Dependency Window**: The vault remains in `PENDING` state if the external RWA data source is offline, requiring manual recovery or timeout mechanisms if off-chain updates stall indefinitely.
