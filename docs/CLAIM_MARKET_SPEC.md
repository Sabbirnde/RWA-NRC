# Fixed-Price Peer-to-Peer Claim Marketplace Specification

> **Frozen Baseline Architecture Segment**:  
> `Claim Registry ──> Claim Market ──> T+0 Liquidity`

---

## 1. Claim Market Architecture & Purpose

`ClaimMarket.sol` provides early T+0 cash liquidity for depositors holding asynchronous settlement claims prior to off-chain settlement finalization:

```
┌─────────────────────────────────────────────────────────────┐
│                    SELLER (Depositor)                       │
│  Deposited $1,000 USDC in Vault ──> Holds Claim #1 ($1,000)  │
└──────────────────────────────┬──────────────────────────────┘
                               │ listClaim(claimId=1, price=980 USDC)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                     CLAIM MARKETPLACE                       │
│  - Asserts Seller owns Claim #1                             │
│  - Asserts price <= faceValue (Prevents price gouging)       │
│  - Updates Claim Status: Active ──> Listed                  │
└──────────────────────────────┬──────────────────────────────┘
                               │ buyClaim(claimId=1)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                       BUYER (Investor)                      │
│  - Pays $980 USDC directly to Seller (T+0 Liquidity!)       │
│  - Receives Claim #1 ownership in ClaimRegistry             │
│  - Claims 1,000 vRWA shares upon Vault settlement finality  │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Order Lifecycle & State Transitions

1. `listClaim(claimId, price)`:
   - Asserts `0 < price <= claim.faceValue`
   - Asserts `claim.owner == msg.sender`
   - Asserts `claim.status != Settled`
   - Creates active listing and updates claim status to `Listed`.
2. `cancelListing(claimId)`:
   - Asserts listing is active and `listing.seller == msg.sender`.
   - Deactivates listing and reverts claim status to `Active`.
3. `buyClaim(claimId)`:
   - Asserts listing is active and `seller != msg.sender` (prevents self-buying).
   - Transfers `price` USDC from buyer to seller (Immediate T+0 payout).
   - Transfers claim ownership in `ClaimRegistry.sol` to buyer.

---

## 3. Market Attack Mitigations

| Attack Vector | Defense Mechanism | Test Case Outcome |
|---|---|---|
| **Fake Claim Listing** | `claimRegistry.getClaim(claimId)` reverts `ClaimNotFound()` | ✅ **PASS** |
| **Non-Owner Listing** | Asserts `claim.owner == msg.sender` (reverts `NotClaimOwner()`) | ✅ **PASS** |
| **Price Gouging (> Face Value)** | Asserts `price <= claim.faceValue` (reverts `InvalidPrice()`) | ✅ **PASS** |
| **Zero Price Listing** | Asserts `price > 0` (reverts `InvalidPrice()`) | ✅ **PASS** |
| **Self-Buying / Fake Liquidity** | Asserts `seller != msg.sender` (reverts `CannotBuySelf()`) | ✅ **PASS** |
| **Cancelled Listing Purchase** | Asserts `listing.active` (reverts `ListingNotActive()`) | ✅ **PASS** |
| **Post-Settlement Listing** | Asserts `claim.status != Settled` (reverts `ClaimAlreadySettled()`) | ✅ **PASS** |
| **Reentrancy Attacks** | OpenZeppelin `ReentrancyGuard` (`nonReentrant` modifier) | ✅ **PASS** |
