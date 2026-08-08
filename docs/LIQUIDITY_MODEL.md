# Protocol Liquidity & Economic Safety Model

> **Frozen Baseline Architecture Segment**:  
> `Claim Market ──> T+0 Liquidity`

---

## 1. Economic Motivation: Buyer & Seller Incentives

### Why does a seller list a settlement claim?
An asynchronous RWA vault deposit takes off-chain time (T+N settlement latency) to verify custody, banking feeds, and issue signed attestations. Depositors who require immediate cash liquidity cannot wait T+N. They sell their pending settlement claim on `ClaimMarket.sol` at a small discount (e.g. 2% discount: $1,000 claim for $980 USDC) to receive **instant T+0 cash liquidity**.

### Why does a buyer purchase a settlement claim?
A buyer purchases a claim to capture the **discounted yield spread** (time-value of money). By paying $980 USDC today for a verified $1,000 claim entitlement, the buyer secures a risk-adjusted return ($20 profit upon settlement) when the vault settles and mints $1,000 worth of `vRWA` vault shares.

---

## 2. Buyer Protections & Settlement Risk Mitigations

### What protects the buyer if settlement is delayed or fails?

1. **Underlying Escrowed Assets**: Underlying USDC funds transferred by the seller during `requestDeposit()` are held in escrow directly by `AsyncRWAVault.sol`. The seller cannot withdraw these funds once deposited.
2. **On-Chain Claim Ownership Register**: `ClaimRegistry.sol` immutably updates claim ownership to the buyer upon secondary purchase. When off-chain attestation settles, `vault.claimShares(requestId)` queries `claimRegistry.getClaimOwner(claimId)` and mints `vRWA` shares **directly to the buyer**.
3. **Rejection Safeguards**: If off-chain RWA Middleware rejects an attestation (`onAttestationRejected`), zero unbacked shares are minted (`claimableShares` remains 0).

---

## 3. End-to-End T+0 Liquidity Flow

```
1. Depositor locks 1,000 USDC in AsyncRWAVault.requestDeposit()
   ├── Vault locks 1,000 USDC in contract escrow
   └── ClaimRegistry creates Claim #1 (faceValue = 1,000 USDC, owner = Seller)

2. Seller lists Claim #1 on ClaimMarket for 980 USDC (2% discount)
   └── ClaimMarket sets Listing #1 active

3. Buyer calls ClaimMarket.buyClaim(1)
   ├── 980 USDC transferred instantly from Buyer ──> Seller (T+0 Liquidity!)
   └── ClaimRegistry updates Claim #1 owner ──> Buyer

4. RWA Middleware verifies real-world custody & issues signed attestation
   └── RWAOracleAdapter submits attestation to AsyncRWAVault.onAttestationSettled()

5. Buyer calls AsyncRWAVault.claimShares("REQ-0001")
   ├── Vault checks ClaimRegistry.getClaimOwner(1) === Buyer
   └── Vault mints 1,000 vRWA shares directly to Buyer (Yield Captured!)
```

---

## 4. Trust & Economic Assumptions

- **Assumed**: Off-Chain RWA Middleware correctly validates bank/custody data before issuing signed EIP-712 attestations.
- **Assumed**: Buyers possess sufficient USDC capital to provide T+0 liquidity on secondary listings.
- **Enforced On-Chain**: No seller can sell a claim for more than its face value (`price <= faceValue`).
- **Enforced On-Chain**: No seller can buy their own listing or double-sell a claim.
