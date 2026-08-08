# 5-Minute Conference Presentation Demo Script

## Runbook Overview

Open `http://localhost:5173/demo` in your browser to access the guided presenter runbook.

### Checkpoint 1 — Set the Stakes
- **Line**: *"Traditional vaults assume a deposit settles immediately. Real-world assets do not."*
- **Action**: Show traditional vs asynchronous vault comparison cards.

### Checkpoint 2 — Alice Deposits
- **Line**: *"Alice submits 1,000 USDC. The vault records intent, but issues no final shares."*
- **Action**: Submit deposit request `REQ-0001`. Point to `PENDING` status and `$0.00` claimable shares.

### Checkpoint 3 — Prove the State
- **Line**: *"We are not treating external data as an oracle. It has to pass the full trust boundary before the vault can move."*
- **Action**: Run valid middleware processing. Show request transitioning to `CLAIMABLE`.

### Checkpoint 4 — Alice Claims Shares
- **Line**: *"The user can claim now because the protocol has evidence, not because a button was pressed."*
- **Action**: Click **Claim Shares**. Point to finalized vault share position.

### Checkpoint 5 — Bob Provides T+0 Liquidity
- **Line**: *"The claim market closes the liquidity gap. Alice exits early; Bob receives the future settlement right."*
- **Action**: Buy Alice's $1,000 claim for $980 as Bob on the Claim Market.

### Checkpoint 6 — Fail Safely
- **Line**: *"When data is uncertain, the protocol delays settlement."*
- **Action**: Trigger **Simulate Invalid Data**. Show risk engine flagging `STALE_DATA` and vault holding settlement.
