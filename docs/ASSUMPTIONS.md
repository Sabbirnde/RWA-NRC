# Protocol Limitations & Assumptions

This document outlines key technical assumptions, operational constraints, and scope boundaries of the Testnet Proof of Concept (PoC).

---

## 📌 Technical & Operational Assumptions

1. **Testnet PoC Scope**:
   - The current implementation is optimized for testnet demonstration on **Base Sepolia** and local Anvil nodes.

2. **Decoupled Attester Signer**:
   - The middleware uses a single dedicated private key (`ATTESTER_PRIVATE_KEY`) for EIP-712 signing. Production deployment should transition to a Multi-Sig or Threshold Cryptography Network (e.g. Chainlink Functions / MPC).

3. **In-Memory Ledgers**:
   - Fast state operations during conference demos use in-memory stores in `artifacts/api-server`. Production deployments should hook into a persistent PostgreSQL indexer.

4. **Firecrawl Data Ingestion**:
   - Firecrawl API calls inspect public web endpoints (e.g. Treasury.gov). If Firecrawl is offline or key is unconfigured, system falls back gracefully to `MockRWAProvider`.
   - Firecrawl data is strictly treated as `"External Reference Data"`, never as an official oracle.

5. **ERC-7540 Asynchronous Semantics**:
   - The vault follows ERC-7540 async deposit/redemption semantics, storing request sequence states on-chain in `AsyncRWAVault.sol`.
