import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RiskEngine } from "./riskEngine";
import { NormalizationEngine } from "./normalizationEngine";
import { ValidationEngine } from "./validationEngine";
import { FreshnessEngine } from "./freshnessEngine";
import { CanonicalRWAObservation } from "./rwaProvider";

describe("GATE 2.5 — RWA Risk Engine Validation Suite", () => {
  const riskEngine = new RiskEngine();
  const normalizer = new NormalizationEngine();
  const validator = new ValidationEngine(300);
  const freshnessEngine = new FreshnessEngine(300);

  const validRawInput: CanonicalRWAObservation = {
    observationId: "obs-gate-2-5-valid",
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
    metadata: { issuer: "US Treasury" },
    metadataHash: "hash-25",
    rawHash: "raw-25",
  };

  it("Test 1 — Valid Asset: RWA-001 -> Risk = PASS", () => {
    const normalized = normalizer.normalize(validRawInput);
    const valRes = validator.validate(normalized);
    const freshness = freshnessEngine.evaluate(normalized.timestamp);
    const riskRes = riskEngine.evaluate(normalized, valRes, freshness);

    assert.strictEqual(riskRes.status, "PASS");
    assert.strictEqual(riskRes.reasonCodes.length, 0);
  });

  it("Test 2 — Unverified Custody: Custody = UNVERIFIED -> Risk = FAIL", () => {
    const raw = { ...validRawInput, custodyStatus: "UNVERIFIED" as any };
    const normalized = normalizer.normalize(raw);
    const valRes = validator.validate(normalized);
    const freshness = freshnessEngine.evaluate(normalized.timestamp);
    const riskRes = riskEngine.evaluate(normalized, valRes, freshness);

    assert.strictEqual(riskRes.status, "FAIL");
    assert.ok(riskRes.reasonCodes.length > 0);
  });

  it("Test 3 — Stale Data: Timestamp TOO OLD -> Risk = FAIL", () => {
    const staleTime = Math.floor(Date.now() / 1000) - 400; // > 300s
    const raw = { ...validRawInput, timestamp: staleTime };
    const normalized = normalizer.normalize(raw);
    const valRes = validator.validate(normalized);
    const freshness = freshnessEngine.evaluate(normalized.timestamp, 300, Math.floor(Date.now() / 1000));
    const riskRes = riskEngine.evaluate(normalized, valRes, freshness);

    assert.strictEqual(riskRes.status, "FAIL");
    assert.ok(riskRes.reasonCodes.length > 0);
  });

  it("Test 4 — Invalid NAV: NAV = 0, -100, null, 'invalid' -> Risk = FAIL", () => {
    const invalidNavValues = [0, -100, null as any, "invalid" as any];
    for (const navVal of invalidNavValues) {
      const raw = { ...validRawInput, valuation: navVal, nav: navVal };
      const normalized = normalizer.normalize(raw);
      const valRes = validator.validate(normalized);
      const freshness = freshnessEngine.evaluate(normalized.timestamp);
      const riskRes = riskEngine.evaluate(normalized, valRes, freshness);

      assert.strictEqual(riskRes.status, "FAIL");
      assert.ok(riskRes.reasonCodes.length > 0);
    }
  });

  it("Test 5 — Unknown Asset: Asset = RWA-999 -> Risk = FAIL (or Validation Failure)", () => {
    const raw = { ...validRawInput, assetId: "RWA-999", source: "Disallowed Provider" };
    const normalized = normalizer.normalize(raw);
    const valRes = validator.validate(normalized);
    const freshness = freshnessEngine.evaluate(normalized.timestamp);
    const riskRes = riskEngine.evaluate(normalized, valRes, freshness);

    assert.strictEqual(riskRes.status, "FAIL");
    assert.ok(riskRes.reasonCodes.length > 0);
  });

  it("Test 6 — Uncertain Data: Custody = UNKNOWN -> Risk = FAIL", () => {
    const raw = { ...validRawInput, custodyStatus: "PENDING" as any };
    const normalized = normalizer.normalize(raw);
    const valRes = validator.validate(normalized);
    const freshness = freshnessEngine.evaluate(normalized.timestamp);
    const riskRes = riskEngine.evaluate(normalized, valRes, freshness);

    assert.strictEqual(riskRes.status, "FAIL");
    assert.ok(riskRes.reasonCodes.length > 0);
  });

  it("Critical Fail-Closed Verification — UNKNOWN, UNVERIFIED, STALE, INVALID, UNCERTAIN NEVER yield PASS", () => {
    const nonPassScenarios: Array<{ name: string; raw: CanonicalRWAObservation }> = [
      { name: "UNKNOWN", raw: { ...validRawInput, source: "UNKNOWN_PROVIDER" } },
      { name: "UNVERIFIED", raw: { ...validRawInput, custodyStatus: "UNVERIFIED" as any } },
      { name: "STALE", raw: { ...validRawInput, timestamp: Math.floor(Date.now() / 1000) - 500 } },
      { name: "INVALID", raw: { ...validRawInput, valuation: -50 } },
      { name: "UNCERTAIN", raw: { ...validRawInput, settlementStatus: "PENDING" as any } },
    ];

    for (const scenario of nonPassScenarios) {
      const normalized = normalizer.normalize(scenario.raw);
      const valRes = validator.validate(normalized);
      const freshness = freshnessEngine.evaluate(normalized.timestamp, 300, Math.floor(Date.now() / 1000));
      const riskRes = riskEngine.evaluate(normalized, valRes, freshness);

      assert.strictEqual(
        riskRes.status,
        "FAIL",
        `Scenario ${scenario.name} failed to fail-closed! Returned ${riskRes.status}`
      );
    }
  });
});
