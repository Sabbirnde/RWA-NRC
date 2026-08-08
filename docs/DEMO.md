# Conference Presentation Runbook (7-Part Flow)

This runbook guides presenters step-by-step through a live demonstration of the Asynchronous RWA Vault, Real-World State Middleware, and T+0 Claim Market.

---

## 🎬 DEMO PART 1 — THE PROBLEM

### Screen / Visual:
- Open `http://localhost:5173/demo`.
- Contrast standard ERC-4626 static execution against asynchronous RWA settlement rails.

```
Traditional Vault: Deposit ──> Immediate Settlement (Same Block)
RWA Reality:       Deposit ──> T+2 / T+3 Off-Chain Settlement Window
```

### Presenter Script:
> *"Traditional DeFi vaults assume instant, block-level execution. But tokenized Real-World Assets rely on banking rails, wire cutoffs, and custody verification. **This temporal mismatch creates the architectural problem.**"*

---

## 🏛 DEMO PART 2 — ASYNCHRONOUS VAULT

### Screen / Actions:
1. Navigate to `/vault`.
2. Submit a deposit request for **1000 USDC** as Alice (`alice@northstar.capital`).
3. Display generated **Deposit Request #001**.
4. Visual Status: `PENDING`.

### Presenter Script:
> *"Notice that Request #001 is queued as PENDING. **No shares are prematurely issued.** The collateral is safely held, but vault shares will not exist until off-chain settlement is cryptographically attested."*

---

## ⚡ DEMO PART 3 — REAL-WORLD STATE

### Screen / Visual:
1. Open the Middleware Dashboard (`/monitor` or `/assets`).
2. Show normalized RWA state metrics:
   - **NAV**: `$1,002,500`
   - **Yield**: `5.20%`
   - **Custody**: `VERIFIED`
   - **Settlement**: `SETTLED`
   - **Risk**: `LOW`
3. Point out data source indicators: **Mock RWA Provider / Firecrawl**.

### Presenter Script:
> *"The middleware ingests reference data from external sources—such as Treasury.gov via Firecrawl and custodian APIs—normalizing real-world financial state into a structured payload."*

---

## 🔍 DEMO PART 4 — VALIDATION

### Screen / Actions:
1. Select Request #001 in `/requests`.
2. Click **Run validation**.
3. Display the 5-step middleware verification pipeline:
```
Data Received ──> Freshness Check (<5m) ──> Validation ──> Risk Engine ──> EIP-712 Attestation
```

### Presenter Script:
> *"Before any attestation is generated, the middleware runs a 10-point sanity check, asserts data freshness under 5 minutes, and evaluates credit posture. Only when all checks pass does it produce a signed EIP-712 proof."*

---

## ⛓️ DEMO PART 5 — ON-CHAIN SETTLEMENT

### Screen / Actions:
1. Middleware submits signed EIP-712 attestation to `RWAOracleAdapter.sol`.
2. Status Transition: `PENDING ──> CLAIMABLE`.
3. Click **Claim Shares**.
4. Show `vRWA` vault shares minted to Alice's balance.

### Presenter Script:
> *"The Oracle Adapter recovers the attester signature on-chain, validates the nonce, and invokes the vault callback. Request #001 transitions from PENDING to CLAIMABLE, allowing Alice to claim her final vault shares."*

---

## 💸 DEMO PART 6 — LIQUIDITY GAP

### Screen / Actions:
1. Create another pending deposit claim (Request #002 for 1000 USDC).
2. Go to `/claims` and list the claim:
   - **Face Value**: `$1,000`
   - **Sale Price**: `$980` (2.00% fixed discount)
3. Switch account to Bob (`bob@treasury.capital`) and click **BUY CLAIM**.
4. Show results:
   - **Seller (Alice)**: Receives **$980 USDC** instant **T+0 liquidity**.
   - **Buyer (Bob)**: Receives **Claim Ownership** in `ClaimRegistry`.

### Presenter Script:
> *"If Alice cannot wait T+2 days for banking settlement, she lists her claim at a 2% discount. Bob buys the claim for 980 USDC. Alice gets instant T+0 liquidity, while Bob acquires the right to claim the 1,000 vault shares upon settlement."*

---

## 🚨 DEMO PART 7 — FAILURE & FAIL-CLOSED SAFETY

### Screen / Actions:
1. In `/monitor` or `/requests`, enable **Simulate Invalid Data** (or trigger `STALE DATA`).
2. Submit a new deposit request #003 and click **Run validation**.
3. Display pipeline output:
   - **Risk Engine**: `FAIL (STALE_DATA)`
   - **Settlement Status**: `BLOCKED (EXCEPTION)`
   - Request remains strictly in `PENDING` / `EXCEPTION` state with `$0.00` claimable shares.

### Presenter Script:
> *"When external reference data is stale, corrupted, or unverified, **the system fails safely by delaying settlement instead of settling against uncertain state.** Delay is a successful security outcome."*
