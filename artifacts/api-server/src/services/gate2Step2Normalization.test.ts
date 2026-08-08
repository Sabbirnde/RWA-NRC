import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NormalizationEngine } from "./normalizationEngine";
import { ValidationEngine } from "./validationEngine";
import { CanonicalRWAObservation } from "./rwaProvider";

describe("GATE 2.2 — RWA Data Normalization Validation Suite", () => {
  const normalizer = new NormalizationEngine();
  const validator = new ValidationEngine(300);

  it("Test 1 — Valid Input (RWA-001)", () => {
    const rawInput: CanonicalRWAObservation = {
      observationId: "obs-rwa-001-test",
      assetId: "RWA-001",
      assetType: "TREASURY",
      valuation: 1000000,
      nav: 1000000,
      yieldRate: 5.2,
      currency: "USD",
      timestamp: Math.floor(Date.now() / 1000),
      source: "Mock RWA Provider",
      dataSource: "Mock RWA Provider",
      sourceUrl: "https://mock.treasury.gov/api/v1/assets/RWA-001",
      jurisdiction: "US",
      status: "VERIFIED",
      custodyStatus: "VERIFIED",
      settlementStatus: "SETTLED",
      riskStatus: "PASS",
      metadata: { issuer: "US Treasury", CUSIP: "912828X10" },
      metadataHash: "hash-001",
      rawHash: "raw-hash-001",
    };

    const normalized = normalizer.normalize(rawInput);

    assert.strictEqual(normalized.assetId, "RWA-001");
    assert.strictEqual(normalized.valuation, 1000000);
    assert.strictEqual(normalized.nav, 1000000);
    assert.strictEqual(normalized.valuation6Decimals, 1000000000000n);
    assert.strictEqual(normalized.yieldRate, 5.2);
    assert.strictEqual(normalized.custodyStatus, "VERIFIED");
    assert.strictEqual(normalized.settlementStatus, "SETTLED");
    assert.strictEqual(normalized.currency, "USD");
    assert.strictEqual(normalized.source, "Mock RWA Provider");

    const valRes = validator.validate(normalized);
    assert.strictEqual(valRes.valid, true);
    assert.strictEqual(valRes.errors.length, 0);
  });

  it("Test 2 — Missing Fields Rejection", () => {
    const missingAssetId = {
      observationId: "obs-test",
      assetId: "",
      valuation: 1000000,
      timestamp: Math.floor(Date.now() / 1000),
      source: "Mock Provider",
      custodyStatus: "VERIFIED",
      settlementStatus: "SETTLED",
    } as any;

    const val1 = validator.validate(normalizer.normalize(missingAssetId));
    assert.strictEqual(val1.valid, false);
    assert.ok(val1.errors.includes("INVALID_ASSET_ID"));

    const missingNAV = {
      observationId: "obs-test",
      assetId: "RWA-001",
      valuation: 0,
      timestamp: Math.floor(Date.now() / 1000),
      source: "Mock Provider",
      custodyStatus: "VERIFIED",
      settlementStatus: "SETTLED",
    } as any;

    const val2 = validator.validate(normalizer.normalize(missingNAV));
    assert.strictEqual(val2.valid, false);
    assert.ok(val2.errors.includes("INVALID_NAV"));

    const missingTimestamp = {
      observationId: "obs-test",
      assetId: "RWA-001",
      valuation: 1000000,
      timestamp: 0,
      source: "Mock Provider",
      custodyStatus: "VERIFIED",
      settlementStatus: "SETTLED",
    } as any;

    const val3 = validator.validate(normalizer.normalize(missingTimestamp));
    assert.strictEqual(val3.valid, false);
    assert.ok(val3.errors.includes("INVALID_TIMESTAMP"));
  });

  it("Test 3 — Invalid Types Rejection", () => {
    const invalidNAVType = {
      observationId: "obs-test",
      assetId: "RWA-001",
      valuation: "one million" as any,
      timestamp: Math.floor(Date.now() / 1000),
      source: "Mock Provider",
      custodyStatus: "VERIFIED",
      settlementStatus: "SETTLED",
    } as any;

    const val1 = validator.validate(normalizer.normalize(invalidNAVType));
    assert.strictEqual(val1.valid, false);
    assert.ok(val1.errors.includes("INVALID_NAV"));
  });

  it("Test 4 — Unknown / Invalid Enum Values Rejection", () => {
    const invalidCustody = {
      observationId: "obs-test",
      assetId: "RWA-001",
      valuation: 1000000,
      timestamp: Math.floor(Date.now() / 1000),
      source: "Mock Provider",
      custodyStatus: "RANDOM_VALUE" as any,
      settlementStatus: "SETTLED",
    } as any;

    const val1 = validator.validate(normalizer.normalize(invalidCustody));
    assert.strictEqual(val1.valid, false);
    assert.ok(val1.errors.includes("CUSTODY_NOT_VERIFIED"));

    const invalidSettlement = {
      observationId: "obs-test",
      assetId: "RWA-001",
      valuation: 1000000,
      timestamp: Math.floor(Date.now() / 1000),
      source: "Mock Provider",
      custodyStatus: "VERIFIED",
      settlementStatus: "RANDOM_VALUE" as any,
    } as any;

    const val2 = validator.validate(normalizer.normalize(invalidSettlement));
    assert.strictEqual(val2.valid, false);
    assert.ok(val2.errors.includes("SETTLEMENT_NOT_CONFIRMED"));
  });
});
