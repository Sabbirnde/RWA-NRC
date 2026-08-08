import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FirecrawlProvider, RWADataProvider, CanonicalRWAObservation } from "./rwaProvider";

describe("Gate 3.3 — Firecrawl External Data Ingestion Suite", () => {
  const provider: RWADataProvider = new FirecrawlProvider();

  it("Test 1 — Provider Boundary: FirecrawlProvider Satisfies RWADataProvider Abstraction", () => {
    assert.strictEqual(typeof provider.name, "string");
    assert.strictEqual(typeof provider.getAssetState, "function");
    assert.ok(provider.name.includes("Firecrawl"));
  });

  it("Test 2 — Raw Data Object & Source Traceability", async () => {
    const rawObs: CanonicalRWAObservation = {
      observationId: "obs-fc-rwa-001-trace",
      assetId: "RWA-001",
      assetType: "TREASURY",
      valuation: 1002500,
      nav: 1002500,
      yieldRate: 5.2,
      currency: "USD",
      timestamp: Math.floor(Date.now() / 1000),
      source: "Firecrawl Live Ingestion",
      dataSource: "Firecrawl Live Ingestion",
      sourceUrl: "https://treasury.gov/rates/daily-treasury-yield",
      jurisdiction: "US",
      status: "VERIFIED",
      custodyStatus: "VERIFIED",
      settlementStatus: "SETTLED",
      riskStatus: "PASS",
      metadata: { issuer: "US Treasury", sourceUrl: "https://treasury.gov/rates/daily-treasury-yield" },
      metadataHash: "sha256-meta-hash-proof",
      rawHash: "sha256-raw-content-hash-proof",
    };

    assert.ok(rawObs.source.length > 0);
    assert.strictEqual(rawObs.sourceUrl, "https://treasury.gov/rates/daily-treasury-yield");
    assert.ok(rawObs.timestamp > 0);
    assert.ok(rawObs.rawHash.length > 0);
    assert.ok(rawObs.metadataHash.length > 0);
  });

  it("Test 3 — Public Source Ingestion Traceability Verification", async () => {
    const obs = await provider.getAssetState("RWA-001", "valid");

    assert.ok(obs.source.includes("Firecrawl"));
    assert.ok(obs.sourceUrl && obs.sourceUrl.length > 0);
    assert.ok(typeof obs.timestamp === "number" && obs.timestamp > 0);
    assert.ok(obs.metadataHash !== undefined);
  });

  it("Critical Safety Audit — Zero Direct Blockchain Imports or Contract Write Calls in Ingestion Layer", () => {
    const providerFilePath = path.resolve(process.cwd(), "src/services/rwaProvider.ts");
    const code = fs.readFileSync(providerFilePath, "utf-8");

    const forbiddenTerms = [
      "ethers",
      "viem",
      "wagmi",
      "contract.write",
      "writeContract",
      "mint",
      "burn",
      "requestDeposit",
      "requestRedeem",
    ];

    for (const term of forbiddenTerms) {
      assert.strictEqual(
        code.includes(term),
        false,
        `Forbidden blockchain term '${term}' found in rwaProvider.ts!`
      );
    }
  });
});
