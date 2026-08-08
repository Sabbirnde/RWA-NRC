# Gate 7 — Hypothesis H1 Final Research Metrics

This document presents the quantitative empirical metrics captured during the Gate 7 H1 controlled research experiments (Steps 1–11).

---

## Empirical Research Metrics Table

| Metric # | Metric | Value | Evidence Source | Interpretation |
|---|---|---|---|---|
| **1** | **Premature Share Issuance** | `0 vRWA` | [`Gate7H1Step8CoreH1ConditionValidation.test.ts`](file:///e:/Projects/Rwa-Claim-Market/packages/contracts/test/Gate7H1Step8CoreH1ConditionValidation.test.ts) | 0 shares issued to depositor while request remains in `PENDING` state. |
| **2** | **Premature Share Issuance Rate** | `0%` | [`Gate7H1Step8CoreH1ConditionValidation.test.ts`](file:///e:/Projects/Rwa-Claim-Market/packages/contracts/test/Gate7H1Step8CoreH1ConditionValidation.test.ts) | $\frac{0\text{ premature shares}}{1,000\text{ settled shares}} = 0\%$. Complete separation achieved. |
| **3** | **Successful Asynchronous Settlement Rate** | `100%` (1/1 valid requests) | [`Gate7H1Step9FinalSettlementValidation.test.ts`](file:///e:/Projects/Rwa-Claim-Market/packages/contracts/test/Gate7H1Step9FinalSettlementValidation.test.ts) | All valid deposit requests with valid attestation successfully settled. |
| **4** | **Deposit-to-Verification Latency** ($T_2 - T_0$) | `7 seconds` | [`Gate7H1Step10TemporalSeparationValidation.test.ts`](file:///e:/Projects/Rwa-Claim-Market/packages/contracts/test/Gate7H1Step10TemporalSeparationValidation.test.ts) | Time elapsed from `requestDeposit()` to middleware verification completion. |
| **5** | **Deposit-to-Claimable Latency** ($T_4 - T_0$) | `7 seconds` | [`Gate7H1Step10TemporalSeparationValidation.test.ts`](file:///e:/Projects/Rwa-Claim-Market/packages/contracts/test/Gate7H1Step10TemporalSeparationValidation.test.ts) | Time elapsed from `requestDeposit()` to `CLAIMABLE` state transition. |
| **6** | **Deposit-to-Settlement Latency** ($T_5 - T_0$) | `10 seconds` | [`Gate7H1Step10TemporalSeparationValidation.test.ts`](file:///e:/Projects/Rwa-Claim-Market/packages/contracts/test/Gate7H1Step10TemporalSeparationValidation.test.ts) | Total time elapsed from `requestDeposit()` to `claimShares()` execution. |
| **7** | **Verification-to-Settlement Latency** ($T_5 - T_2$) | `3 seconds` | [`Gate7H1Step10TemporalSeparationValidation.test.ts`](file:///e:/Projects/Rwa-Claim-Market/packages/contracts/test/Gate7H1Step10TemporalSeparationValidation.test.ts) | Delay between off-chain RWA verification approval and final share minting. |
| **8** | **Number of Successful Settlements** | `1` (`REQ-0001`) | [`Gate7H1Step9FinalSettlementValidation.test.ts`](file:///e:/Projects/Rwa-Claim-Market/packages/contracts/test/Gate7H1Step9FinalSettlementValidation.test.ts) | 1 valid deposit request transitioned to `FINALIZED` with shares issued. |
| **9** | **Number of Failed Verification Attempts** | `1` (`REQ-0002`) | [`Gate7H1Step11NegativeControlExperiment.test.ts`](file:///e:/Projects/Rwa-Claim-Market/packages/contracts/test/Gate7H1Step11NegativeControlExperiment.test.ts) | 1 stale RWA data observation (age 37m > 10m) rejected by freshness engine. |
| **10** | **Number of Prevented Settlements** | `1` (`REQ-0002`) | [`Gate7H1Step11NegativeControlExperiment.test.ts`](file:///e:/Projects/Rwa-Claim-Market/packages/contracts/test/Gate7H1Step11NegativeControlExperiment.test.ts) | 1 settlement attempt blocked on-chain via `StaleAttestation` revert error. |
| **11** | **Number of Prematurely Issued Shares** | `0 vRWA` | [`Gate7H1Step8CoreH1ConditionValidation.test.ts`](file:///e:/Projects/Rwa-Claim-Market/packages/contracts/test/Gate7H1Step8CoreH1ConditionValidation.test.ts) | Absolute count of shares minted before attestation approval is 0. |

---

> **Note on Statistical Significance**: The metrics above represent deterministic single-execution Proof-of-Concept empirical measurements under controlled test conditions. They do not claim statistical generality or multi-sample variance across stochastic network environments.
