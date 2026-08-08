# 5-Minute Conference Presentation Runbook

This runbook guides presenters step-by-step through a 5-minute live demonstration of the Asynchronous RWA Vault, Real-World State Middleware, and T+0 Claim Market.

---

## ⏱ 5-Minute Presentation Script & Flow

### Minute 0:00 - 1:00 | The Temporal Mismatch
1. Open `http://localhost:5173/demo`.
2. Presenter Statement:
   > *"Traditional vaults assume instantaneous execution. Real-world assets—like US Treasuries—do not settle atomically. The gap between on-chain deposit intent and off-chain settlement is where vulnerabilities occur."*

### Minute 1:00 - 2:00 | Deposit & Premature Minting Protection
1. Navigate to `/vault` and submit a deposit request for **$1,000 USDC** as Alice (`alice@northstar.capital`).
2. Point to the generated **Deposit Request #001** and its status: `PENDING`.
3. Highlight that `claimableShares` is strictly `$0.00`. No shares have been minted.

### Minute 2:00 - 3:00 | Middleware Validation & EIP-712 Attestation
1. Navigate to `/requests` and select Request #001.
2. Click **Process** (in `Valid` demo mode).
3. Walk through the 8-step presentation timeline:
   `Request Created -> Data Requested -> RWA Data Received -> Validation Passed -> Risk Passed -> Attestation Generated -> Blockchain Updated -> Claimable`.
4. Explain that the middleware normalized Treasury yield reference data, verified freshness (<5m), and signed an EIP-712 attestation for `RWAOracleAdapter.sol`.

### Minute 3:00 - 4:00 | T+0 Liquidity Bridge via Fixed-Price Claim Market
1. Navigate to `/claims`.
2. Show Alice listing Claim #1 for **$980 USDC** (2.00% discount for immediate T+0 cashflow).
3. Switch buyer account to Bob (`bob@treasury.capital`) and click **BUY CLAIM**.
4. Show instant USDC transfer to Alice and claim ownership transfer to Bob in `ClaimRegistry`.

### Minute 4:00 - 5:00 | Fail-Closed Security Demonstration
1. Toggle **Process Mode** to `Invalid` (or enable Failure Mode in `/monitor`).
2. Submit a new deposit request #002 and click **Process**.
3. Point out that the timeline halts at Step #4 (`Validation Passed`), marking status as `BLOCKED` (`EXCEPTION`).
4. Conclude:
   > *"When external reference data is stale or unverified, the protocol delays settlement rather than guessing. Delay is a successful outcome."*
