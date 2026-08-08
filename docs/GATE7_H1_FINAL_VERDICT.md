# Gate 7 — Hypothesis H1 Final Research Certification & Verdict Report

---

## Experimental Setup

The controlled research experiment was executed on an EVM Hardhat local test network (Chain ID: `31337`) paired with a Node.js TypeScript API server middleware (`@workspace/api-server`).

- **Test Actors**: Alice (`0x70997970C51812dc3A010C7d01b50e0d17dc79C8`), Bob (`0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`), Attester Signer (`0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`).
- **Underlying Asset**: `MockUSDC` (`1,000 USDC` = `1,000,000,000` base units, 6 decimals).
- **Target RWA Asset**: `RWA-001` (US Treasury Bill Portfolio, NAV: `$1,002,500`, Yield: `5.2%`).

---

## Hypothesis

> **Research Hypothesis H1**:
> *"An RWA-backed vault can represent asynchronous deposits and settlement without premature share issuance by separating the deposit request from final vault share issuance."*

---

## Baseline

The conventional synchronous reference baseline (standard ERC-4626 control model) executes deposit asset transfer and vault share minting atomically in a single transaction at time $T_0$ ($\Delta T = T_{\text{issuance}} - T_{\text{deposit}} = 0$). It assumes instant off-chain liquidity settlement and zero pending state representation.

---

## Proposed Architecture

The proposed 3-layer architecture separates request creation from share minting using:
1. **ERC-7540 Asynchronous Vault (`AsyncRWAVault.sol`)**: Maintains explicit `RequestState.Pending`, `Claimable`, and `Finalized` states.
2. **RWA Middleware (`@workspace/api-server`)**: Ingests, normalizes, validates (15 schema rules), evaluates freshness (age < 600s), and assesses risk.
3. **EIP-712 Attestation Adapter (`RWAOracleAdapter.sol`)**: Enforces cryptographic signature verification before allowing requests to become claimable.

---

## Actual State Transition

```text
Alice (Deposit 1,000 USDC)
  ↓ [requestDeposit()]
REQ-0001: PENDING (vault.balanceOf(Alice) == 0)
  ↓ [Off-Chain Middleware Pipeline: Ingest → Normalize → Validate → Freshness → Risk]
Attestation Digest Signed (EIP-712)
  ↓ [oracleAdapter.submitAttestation()]
REQ-0001: CLAIMABLE (claimableShares = 1,000 vRWA | balanceOf(Alice) == 0)
  ↓ [vault.claimShares()]
REQ-0001: FINALIZED (1,000 vRWA minted to Alice | totalSupply == 1,000 vRWA)
```

---

## Blockchain Evidence

- **Deposit Request Tx**: `0x7fa281b3c94d07e60b2d6a59bc811f5d2141527ef94e1e07b8cd37bb34ff90d1` (Block #4)
- **Attestation Submission Tx**: `0xb8e967a57a1bc63fa289ed394852c0021c17ee1994e4bc9a1f868dfbb8019a77` (Block #5)
- **Claim Execution Tx**: `0xa59fbfccab4bc51795ccebe2ceab93cf258cbfcfad57edacb06bcbb127c5980a` (Block #6)
- **On-Chain Contract Addresses**:
  - `AsyncRWAVault`: `0x5FbDB2315678afecb367f032d93F642f64180aa3`
  - `RWAOracleAdapter`: `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`

---

## Middleware Evidence

- **Raw Data Ingested**: `observationId: "obs-RWA-001-1786225054"`, `valuation: 1002500`, `status: "VERIFIED"`.
- **Validation**: `valid: true`, 0 schema errors.
- **Freshness**: `freshnessStatus: FRESH`, `ageSeconds: 0s` < `600s`.
- **Risk Evaluation**: `riskScore: 0`, `status: PASS`.
- **Middleware Record State**: `ATTESTABLE`.

---

## Attestation Evidence

- **EIP-712 Typed Struct Hash**: Computed over `Attestation(assetId, requestId, state, nav, yieldRate, riskStatus, nonce, timestamp)`.
- **Signer Verified**: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` recovered on-chain via `ECDSA.recover()`.
- **Events Emitted**: `AttestationAccepted`, `RWAStateUpdated`, `DepositProcessed`, `DepositClaimable`.

---

## Share Issuance Evidence

| Lifecycle Stage | On-Chain Request Status | Alice `vRWA` Share Balance |
|---|---|---|
| Before deposit | N/A | `0 vRWA` |
| Deposit request | `PENDING` (1) | **`0 vRWA`** |
| External verification | `PENDING` (1) | **`0 vRWA`** |
| Attestation submission | `CLAIMABLE` (4) | **`0 vRWA`** |
| Final settlement | `FINALIZED` (5) | **`1,000 vRWA`** |

---

## Failure Evidence

- **Negative Control Test**: Stale RWA data simulation (Data age: `37 minutes` > `10 minutes` threshold).
- **Result**: Middleware evaluated `freshnessStatus = EXPIRED`, `isAttestable = false`. On-chain transaction reverted with `StaleAttestation()`. Request `REQ-0002` remained in `PENDING` state with **0 shares issued** to Bob.

---

## Timing Evidence

- $T_0$ (Deposit Request): `1770522108s`
- $T_2$ (Verification Completed): `1770522115s` ($\Delta T = 7s$)
- $T_4$ (Claimable State): `1770522115s` ($\Delta T = 7s$)
- $T_5$ (Final Settlement): `1770522118s` ($\Delta T = 10s$)
- $T_6$ (Shares Issued): `1770522118s` ($\Delta T = 10s$)
- **Settlement Processing Delay ($T_5 - T_2$)**: `3 seconds`.

---

## Research Metrics

1. **Premature Share Issuance**: `0 vRWA`
2. **Premature Share Issuance Rate**: `0%`
3. **Successful Asynchronous Settlement Rate**: `100%` (1/1 valid requests)
4. **Deposit-to-Verification Latency**: `7 seconds`
5. **Deposit-to-Claimable Latency**: `7 seconds`
6. **Deposit-to-Settlement Latency**: `10 seconds`
7. **Verification-to-Settlement Latency**: `3 seconds`
8. **Successful Settlements**: `1`
9. **Failed Verification Attempts**: `1`
10. **Prevented Settlements**: `1`
11. **Prematurely Issued Shares**: `0 vRWA`

---

## Acceptance Criteria

- [x] **H1-01**: Deposit request exists without immediate share issuance (**PASS**)
- [x] **H1-02**: PENDING is an explicit state (**PASS**)
- [x] **H1-03**: External RWA verification occurs before settlement (**PASS**)
- [x] **H1-04**: Valid attestation enables progression (**PASS**)
- [x] **H1-05**: PENDING does not issue final shares (**PASS**)
- [x] **H1-06**: CLAIMABLE does not cause premature share minting (**PASS**)
- [x] **H1-07**: Final settlement produces correct accounting (**PASS**)
- [x] **H1-08**: Invalid RWA data prevents settlement (**PASS**)
- [x] **H1-09**: System records asynchronous time separation (**PASS**)
- [x] **H1-10**: Complete lifecycle is auditable (**PASS**)

---

## Limitations

1. **Attester Key Authority**: Attestation signing key is currently held by a single authorized account (`attesterSigner`), requiring extension to multi-party computation (MPC) or threshold signatures for decentralized production deployments.
2. **Oracle Availability Window**: If off-chain RWA data feeds become unavailable, pending requests remain indefinitely in `PENDING` state until refreshed data or emergency cancellation is triggered.

---

## Final Verdict

```text
========================================
FINAL RESEARCH VERDICT
========================================

H1 VALIDATED
```

---

## Research Conclusion

The Proof-of-Concept implementation provides empirical evidence supporting Hypothesis H1 under the tested conditions. Specifically, the separation of deposit request creation (`requestDeposit()`) from share issuance (`claimShares()`), governed by off-chain middleware verification and EIP-712 attestation gating, demonstrates that an RWA-backed vault can handle asynchronous settlement with zero premature share issuance.

---

## Reproducible Command Sequence

To independently reproduce all 15 steps of the Gate 7 H1 research experiment:

```bash
# 1. Clone repository
git clone https://github.com/Sabbirnde/RWA-NRC.git
cd RWA-NRC

# 2. Install dependencies
pnpm install

# 3. Execute Smart Contract Gate 7 Test Suite
pnpm --filter @workspace/contracts test

# 4. Execute API Server Middleware Gate 7 Test Suite
pnpm --filter @workspace/api-server test
```
