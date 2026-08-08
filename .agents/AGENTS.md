# Project Engineering & Security Guidelines

This document defines project-scoped behavioral guardrails, architectural principles, and security invariants for the **Asynchronous RWA Vault + Middleware + T+0 Claim Market** workspace.

---

## 1. Product Positioning & Core Triad
- Position the protocol as: **"Asynchronous settlement and liquidity infrastructure for tokenized Real-World Assets (RWAs)."**
- Never describe it simply as an *"RWA tokenization platform."*
- **Core Positioning Triad**:
  - **ERC-7540** handles the asynchronous vault.
  - **Our middleware** handles asynchronous real-world state.
  - **The claim market** handles the liquidity gap.

---

## 2. Most Important Engineering Principle
- **Build the smallest architecture that genuinely demonstrates the research hypothesis.**
- Do NOT attempt to build a complete bank, oracle network, production exchange, legal RWA framework, or commercial financial product.
- The PoC exists solely to prove the 3-layer architecture.

---

## 3. Paramount Security Design Principle
- 🚨 **WHEN DATA IS UNCERTAIN, DELAY SETTLEMENT.**
- Never: `Uncertain data → Settle anyway`.
- Always: `Uncertain data → Remain pending`.
- Delay is considered a successful security outcome across contracts, middleware, UI, and documentation.

---

## 4. Smart Contract & Library Standards
- **Custom Solidity Errors**: Use custom errors (`error CustomError()`) exclusively across all smart contracts. Avoid `require("string")` revert strings on-chain.
- **Standard OpenZeppelin Primitives**: Import directly from `@openzeppelin/contracts` v5 (`ERC20`, `SafeERC20`, `Ownable`, `Pausable`, `ReentrancyGuard`, `ECDSA`, `EIP712`). Do not duplicate security primitives or invent custom security forks.
- **Strict Event Emission**: Maintain strict 18-event protocol lifecycle emission across contracts (`DepositRequested`, `DepositProcessed`, `DepositClaimable`, `DepositClaimed`, `RedeemRequested`, `RedeemProcessed`, `RedeemClaimable`, `RedeemClaimed`, `RWAStateUpdated`, `AttestationAccepted`, `AttestationRejected`, `ClaimCreated`, `ClaimListed`, `ClaimPurchased`, `ClaimTransferred`, `ClaimSettled`, `EmergencyPaused`).
