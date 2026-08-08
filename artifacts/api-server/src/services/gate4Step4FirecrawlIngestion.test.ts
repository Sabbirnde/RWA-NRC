import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FirecrawlProvider, CanonicalRWAObservation } from "./rwaProvider";

describe("Gate 4.4 — Firecrawl External Data Acquisition (Raw Ingestion)", () => {
  const firecrawl = new FirecrawlProvider();

  it("Test 1 — Ingests raw external RWA data for RWA-001 with strict blockchain isolation", async () => {
    // 1. Execute Firecrawl acquisition pipeline
    const rawObs: CanonicalRWAObservation = await firecrawl.getAssetState("RWA-001", "valid");

    // 2. Validate Raw External Data preservation
    assert.ok(rawObs.source.includes("Firecrawl"));
    assert.ok(rawObs.sourceUrl.length > 0);
    assert.strictEqual(rawObs.assetId, "RWA-001");
    assert.ok(rawObs.nav >= 1000000);
    assert.ok(rawObs.yieldRate > 0);
    assert.strictEqual(rawObs.custodyStatus, "VERIFIED");
    assert.ok(rawObs.timestamp > 0);

    // 3. Verify Data Hash calculation
    assert.ok(rawObs.rawHash !== undefined || rawObs.metadataHash !== undefined);

    // 4. Verify Zero Blockchain Mutations capability
    const firecrawlInstance: any = firecrawl;
    assert.strictEqual(firecrawlInstance.signer, undefined);
    assert.strictEqual(firecrawlInstance.privateKey, undefined);
    assert.strictEqual(firecrawlInstance.writeContract, undefined);
    assert.strictEqual(firecrawlInstance.sendTransaction, undefined);

    // 5. Code audit verification for direct blockchain imports in rwaProvider.ts
    const rwaProviderCode = fs.readFileSync(
      path.resolve(process.cwd(), "src/services/rwaProvider.ts"),
      "utf-8"
    );
    assert.strictEqual(rwaProviderCode.includes("writeContract"), false);
    assert.strictEqual(rwaProviderCode.includes("sendTransaction"), false);
    assert.strictEqual(rwaProviderCode.includes("signTypedData"), false);
  });
});
