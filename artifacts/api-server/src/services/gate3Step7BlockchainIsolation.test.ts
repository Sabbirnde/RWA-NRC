import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FirecrawlProvider } from "./rwaProvider";
import { AttestationService } from "./attestationService";

describe("Gate 3.7 — Firecrawl Blockchain Isolation Suite", () => {
  it("Test 1 — Code Audit: Firecrawl Provider Code Contains Zero Blockchain Imports or Write Methods", () => {
    const providerPath = path.resolve(process.cwd(), "src/services/rwaProvider.ts");
    const code = fs.readFileSync(providerPath, "utf-8");

    const forbiddenTerms = [
      "ethers",
      "viem",
      "wagmi",
      "web3",
      "contract.write",
      "writeContract",
      "sendTransaction",
      "mint",
      "burn",
      "settle",
      "requestDeposit",
      "requestRedeem",
    ];

    for (const term of forbiddenTerms) {
      const regex = new RegExp(`\\b${term.replace(".", "\\.")}\\b`, "i");
      assert.strictEqual(
        regex.test(code),
        false,
        `Forbidden term '\\b${term}\\b' matched in FirecrawlProvider implementation!`
      );
    }
  });

  it("Test 2 — Signer Test: Firecrawl Lacks Signing Key & Signing Capabilities", () => {
    const fcProvider = new FirecrawlProvider() as any;
    const attService = new AttestationService();

    assert.strictEqual(fcProvider.attesterAccount, undefined);
    assert.strictEqual(fcProvider.generateAttestation, undefined);
    assert.strictEqual(fcProvider.getSignerAddress, undefined);

    assert.ok(typeof attService.getSignerAddress() === "string");
    assert.ok(attService.getSignerAddress().startsWith("0x"));
  });

  it("Test 3 — Authorization Test: Direct Firecrawl Blockchain Mutation is DENIED", () => {
    const fcProvider = new FirecrawlProvider() as any;

    // Verify Firecrawl instance has no write options or contract handles
    assert.strictEqual(fcProvider.writeContract, undefined);
    assert.strictEqual(fcProvider.sendTransaction, undefined);
    assert.strictEqual(fcProvider.onAttestationSettled, undefined);
  });

  it("Test 4 — Dependency Test: FirecrawlProvider Depends Only on Data Layer Interface", () => {
    const fcProvider = new FirecrawlProvider();

    assert.strictEqual(fcProvider.name, "Firecrawl Data Provider");
    assert.strictEqual(typeof fcProvider.getAssetState, "function");
    assert.strictEqual((fcProvider as any).blockchainService, undefined);
  });
});
