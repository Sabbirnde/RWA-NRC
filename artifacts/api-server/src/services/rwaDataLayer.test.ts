import assert from "node:assert";
import { describe, it } from "node:test";
import { FirecrawlProvider, MockRWAProvider } from "./rwaProvider";
import { ValidationEngine } from "./validationEngine";

describe("External RWA Data Ingestion Layer & Canonical Schema", () => {
  const mockProvider = new MockRWAProvider();
  const firecrawlProvider = new FirecrawlProvider(undefined, mockProvider);
  const validator = new ValidationEngine(300); // 5 minutes

  it("1. Canonical RWA Data Observation Schema Verification", async () => {
    const obs = await mockProvider.getAssetState("RWA-001", "valid");
    assert.ok(obs.observationId, "Missing observationId");
    assert.strictEqual(obs.assetId, "RWA-001");
    assert.strictEqual(obs.assetType, "TREASURY");
    assert.strictEqual(obs.valuation, 1002500);
    assert.strictEqual(obs.currency, "USD");
    assert.ok(obs.timestamp > 0, "Invalid timestamp");
    assert.strictEqual(obs.jurisdiction, "US");
    assert.strictEqual(obs.status, "VERIFIED");
    assert.ok(obs.metadata, "Missing metadata");
    assert.ok(obs.metadataHash, "Missing metadataHash");
  });

  describe("2. Deterministic Mock RWA Provider Simulation Modes (8/8 Modes)", () => {
    it("Mode 1: valid data -> Should pass validation", async () => {
      const obs = await mockProvider.getAssetState("RWA-001", "valid");
      const res = validator.validate(obs as any);
      assert.strictEqual(res.valid, true);
    });

    it("Mode 2: invalid data -> Should fail validation", async () => {
      const obs = await mockProvider.getAssetState("RWA-001", "invalid");
      const res = validator.validate(obs as any);
      assert.strictEqual(res.valid, false);
      assert.ok(res.errors.includes("INVALID_NAV"));
    });

    it("Mode 3: stale data -> Should fail validation with STALE_DATA", async () => {
      const obs = await mockProvider.getAssetState("RWA-001", "stale");
      const res = validator.validate(obs as any);
      assert.strictEqual(res.valid, false);
      assert.ok(res.errors.includes("STALE_DATA"));
    });

    it("Mode 4: missing data -> Should throw error on unknown asset", async () => {
      await assert.rejects(
        async () => mockProvider.getAssetState("UNKNOWN-ASSET", "missing"),
        /not found/
      );
    });

    it("Mode 5: changed valuation -> Should reflect updated valuation", async () => {
      const obs = await mockProvider.getAssetState("RWA-001", "changed_valuation");
      assert.strictEqual(obs.valuation, 1050000);
      assert.strictEqual(validator.validate(obs as any).valid, true);
    });

    it("Mode 6: conflicting data -> Should fail with REJECTED status", async () => {
      const obs = await mockProvider.getAssetState("RWA-001", "conflicting");
      const res = validator.validate(obs as any);
      assert.strictEqual(res.valid, false);
      assert.ok(res.errors.includes("CUSTODY_NOT_VERIFIED"));
    });

    it("Mode 7: duplicate observation -> Should reuse observation ID", async () => {
      const obs1 = await mockProvider.getAssetState("RWA-001", "duplicate_observation");
      const obs2 = await mockProvider.getAssetState("RWA-001", "duplicate_observation");
      assert.strictEqual(obs1.observationId, "obs-RWA-001-fixed-duplicate-id");
      assert.strictEqual(dupObsId(obs1), dupObsId(obs2));
    });

    it("Mode 8: expired data -> Should fail with STALE_DATA", async () => {
      const obs = await mockProvider.getAssetState("RWA-001", "expired");
      const res = validator.validate(obs as any);
      assert.strictEqual(res.valid, false);
      assert.ok(res.errors.includes("STALE_DATA"));
    });
  });

  describe("3. Untrusted Firecrawl Acquisition & Defense Controls", () => {
    it("Source Allowlisting -> Should filter domain urls", () => {
      assert.strictEqual(firecrawlProvider.isAllowedDomain("https://treasury.gov/rates"), true);
      assert.strictEqual(firecrawlProvider.isAllowedDomain("https://malicious-site.org/fake"), false);
    });

    it("Untrusted Fallback -> Should gracefully fall back to Mock Provider", async () => {
      const obs = await firecrawlProvider.getAssetState("RWA-001", "valid");
      assert.ok(obs.source.includes("Firecrawl"));
      assert.strictEqual(validator.validate(obs as any).valid, true);
    });
  });
});

function dupObsId(obs: any) {
  return obs.observationId;
}
