import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NormalizationEngine } from "./normalizationEngine";
import { ValidationEngine } from "./validationEngine";
import { CanonicalRWAObservation } from "./rwaProvider";

describe("Gate 3.4 — Firecrawl Normalization and Validation Suite", () => {
  const normalizer = new NormalizationEngine();
  const validator = new ValidationEngine(300);

  const baseFirecrawlRaw: CanonicalRWAObservation = {
    observationId: "obs-fc-rwa-001-g34",
    assetId: "RWA-001",
    assetType: "TREASURY",
    valuation: 1000000,
    nav: 1000000,
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
    metadataHash: "sha256-meta-hash-34",
    rawHash: "sha256-raw-content-34",
  };

  it("Test 1 — Valid Firecrawl Data -> Normalizer -> Validator -> PASSED", () => {
    const normalized = normalizer.normalize(baseFirecrawlRaw);
    const valRes = validator.validate(normalized);

    assert.strictEqual(valRes.valid, true);
    assert.strictEqual(valRes.errors.length, 0);
  });

  it("Test 2 — Normalized Schema Field Completeness Audit", () => {
    const normalized = normalizer.normalize(baseFirecrawlRaw);

    assert.strictEqual(normalized.assetId, "RWA-001");
    assert.strictEqual(normalized.nav, 1000000);
    assert.strictEqual(normalized.yieldRate, 5.2);
    assert.strictEqual(normalized.custodyStatus, "VERIFIED");
    assert.strictEqual(normalized.settlementStatus, "SETTLED");
    assert.strictEqual(normalized.source, "Firecrawl Live Ingestion");
    assert.strictEqual(normalized.dataSource, "Firecrawl Live Ingestion");
    assert.strictEqual(normalized.sourceUrl, "https://treasury.gov/rates/daily-treasury-yield");
    assert.ok(typeof normalized.timestamp === "number" && normalized.timestamp > 0);
  });

  it("Test 3 — Missing NAV -> REJECTED", () => {
    const raw = { ...baseFirecrawlRaw, valuation: 0, nav: 0 };
    const normalized = normalizer.normalize(raw);
    const valRes = validator.validate(normalized);

    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("INVALID_NAV"));
  });

  it("Test 4 — Negative NAV -> REJECTED", () => {
    const raw = { ...baseFirecrawlRaw, valuation: -100, nav: -100 };
    const normalized = normalizer.normalize(raw);
    const valRes = validator.validate(normalized);

    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("INVALID_NAV"));
  });

  it("Test 5 — Invalid Yield -> REJECTED", () => {
    const raw = { ...baseFirecrawlRaw, yieldRate: -5 };
    const normalized = normalizer.normalize(raw);
    const valRes = validator.validate(normalized);

    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("INVALID_YIELD"));
  });

  it("Test 6 — Invalid Custody -> REJECTED", () => {
    const raw = { ...baseFirecrawlRaw, custodyStatus: "UNVERIFIED" as any };
    const normalized = normalizer.normalize(raw);
    const valRes = validator.validate(normalized);

    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("CUSTODY_NOT_VERIFIED"));
  });

  it("Test 7 — Missing Source URL -> REJECTED", () => {
    const raw = { ...baseFirecrawlRaw, sourceUrl: "" };
    const normalized = normalizer.normalize(raw);
    const valRes = validator.validate(normalized);

    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("MISSING_SOURCE_URL"));
  });

  it("Critical Safety Guarantee — Firecrawl Output NEVER Automatically Becomes Trusted Blockchain State", () => {
    const rejectedPayloads = [
      { ...baseFirecrawlRaw, valuation: 0 },
      { ...baseFirecrawlRaw, yieldRate: -1 },
      { ...baseFirecrawlRaw, custodyStatus: "UNVERIFIED" as any },
      { ...baseFirecrawlRaw, sourceUrl: "" },
    ];

    for (const rawPayload of rejectedPayloads) {
      const normalized = normalizer.normalize(rawPayload);
      const valRes = validator.validate(normalized);

      // Must be rejected by validator
      assert.strictEqual(valRes.valid, false);
      // Guarantee zero signature / transaction generated for invalid raw data
      assert.strictEqual((valRes as any).signature, undefined);
      assert.strictEqual((valRes as any).txHash, undefined);
    }
  });
});
