# Signed Attestation & Cryptographic Provenance Specification

> **Frozen Baseline Architecture Segment**:  
> `RWA Middleware ──> Signed Attestation ──> Oracle Adapter ──> ERC-7540 Async Vault`

---

## 1. Canonical Attestation Payload Structure

The canonical attestation payload is an EIP-712 structured data object containing the off-chain state evaluation results:

```typescript
export interface AttestationPayload {
  assetId: string; // Ticker or CUSIP identifier (e.g. "RWA-001")
  requestId: string; // Vault request identifier (e.g. "REQ-0001")
  state: string; // Lifecycle posture ("SETTLED", "CLAIMABLE", "REJECTED")
  nav: bigint; // Asset NAV in USD (6 decimal places, e.g. 1002500)
  yieldRate: bigint; // Annualized yield rate in basis points (e.g. 520 = 5.20%)
  riskStatus: `0x${string}`; // keccak256 hash of risk posture ("PASS" / "FAIL")
  nonce: bigint; // Monotonically increasing unique nonce
  timestamp: bigint; // Unix epoch timestamp (seconds)
}

export interface SignedAttestation {
  payload: AttestationPayload;
  signature: `0x${string}`; // 65-byte EIP-712 signature (r, s, v)
  signer: `0x${string}`; // Recovered signer Ethereum address
}
```

---

## 2. Security Requirements & Domain Separation

1. **Signer Authentication**: The attestation signature is verified on-chain via `ECDSA.recover`. The recovered address MUST equal the authorized `attesterSigner`.
2. **Domain Separation**: Enforced via EIP-712 domain separator:
   - `name`: `"RWA-OracleAdapter"`
   - `version`: `"1.0.0"`
   - `chainId`: Destination chain ID (e.g. `84532` Base Sepolia, `31337` Anvil)
   - `verifyingContract`: `RWAOracleAdapter` contract address
3. **Replay Protection**: `RWAOracleAdapter.sol` maintains `mapping(uint256 => bool) public usedNonces`. Reused nonces trigger `ReplayedNonce()` revert.
4. **Staleness Protection**: `block.timestamp <= timestamp + maxDataAge` (default: 15 minutes). Expired timestamps trigger `StaleAttestation()` revert.
5. **Key Revocation & Rotation**:
   - `setAttesterSigner(address _signer)` rotates active signer key.
   - `revokeSigner(address _signer)` revokes compromised keys immediately (`RevokedSigner()` revert).

---

## 3. Cryptographic Signer Pipeline

```
Observation ──> Normalization ──> Validation ──> Risk PASS ──> Attestation Payload ──> EIP-712 Signature
```

1. **Observation**: Raw web feed or mock provider observation ingested.
2. **Validation**: 9-point structural checklist & 5-minute freshness check.
3. **Risk Evaluation**: Risk score < 50 and `status === "PASS"`.
4. **Encoding**: Typed structured hash generation using `ATTESTATION_TYPEHASH`.
5. **Signing**: Signed via `ATTESTER_PRIVATE_KEY` using ECDSA secp256k1 curve.
