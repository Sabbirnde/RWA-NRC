# Threat Model

## Threat Vectors & Defenses

1. **Malicious Web Input (Firecrawl Prompt Injection / Arbitrary Web Modification)**:
   - *Risk*: Unsanitized web data attempts to alter vault NAV or force share minting.
   - *Defense*: Firecrawl is NOT an oracle. Web data passes through normalization, schema validation, timestamp freshness checks, risk engine evaluation, and EIP-712 attestation signing before touching `RWAOracleAdapter.sol`.

2. **Attestation Replay Attack**:
   - *Risk*: Attacker re-submits a previously valid attestation signature to force double settlement.
   - *Defense*: Nonces are tracked on-chain in `usedNonces[nonce]`. Reused nonces revert immediately.

3. **Stale Data Arbitrage**:
   - *Risk*: Attacker submits old attestation when NAV was higher.
   - *Defense*: `RWAOracleAdapter` rejects signatures with `block.timestamp > timestamp + maxDataAge`.

4. **Premature Share Minting**:
   - *Risk*: User attempts to claim vault shares immediately after calling `requestDeposit`.
   - *Defense*: Invariant enforced: `claimableShares == 0` during `PENDING`. `claimShares` reverts if `claimableShares == 0`.
