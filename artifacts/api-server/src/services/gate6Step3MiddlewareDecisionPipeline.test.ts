import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NormalizationEngine } from "./normalizationEngine.js";
import { ValidationEngine } from "./validationEngine.js";
import { FreshnessEngine } from "./freshnessEngine.js";
import { RiskEngine } from "./riskEngine.js";

describe("GATE 6.3 — Middleware Decision Pipeline Validation (Stale Data)", () => {
  it("Enforces Freshness & Risk engine blocks on 37-minute stale RWA data", () => {
    const normalizer = new NormalizationEngine();
    const validator = new ValidationEngine(600); // 10 minutes max age (600s)
    const freshnessEngine = new FreshnessEngine(600); // 10 minutes threshold
    const riskEngine = new RiskEngine();

    const currentTimestamp = Math.floor(Date.now() / 1000);
    const dataAgeSeconds = 37 * 60; // 37 minutes = 2220 seconds
    const observationTimestamp = currentTimestamp - dataAgeSeconds;

    const rawData = {
      assetId: "RWA-001",
      nav: 1000000,
      yieldRate: 5.2,
      custodyStatus: "VERIFIED" as const,
      settlementStatus: "SETTLED" as const,
      riskStatus: "PASS" as const,
      timestamp: observationTimestamp,
      source: "Firecrawl",
      sourceUrl: "https://treasury.gov/rates/daily-treasury-yield",
    };

    // 1. Timestamp is parsed correctly
    const normalized = normalizer.normalize(rawData);
    assert.equal(normalized.timestamp, observationTimestamp);

    // 2. Current time is calculated correctly & 3. Data age is calculated correctly
    const freshnessResult = freshnessEngine.evaluate(normalized.timestamp, 600, currentTimestamp);
    assert.equal(freshnessResult.observedAt, observationTimestamp);
    assert.equal(freshnessResult.receivedAt, currentTimestamp);
    assert.equal(freshnessResult.ageSeconds, 2220);

    // 4. Freshness threshold is enforced & 5. Stale data produces FAIL
    assert.equal(freshnessResult.maxAge, 600);
    assert.equal(freshnessResult.freshnessStatus, "EXPIRED");
    assert.equal(freshnessResult.isAttestable, false);

    // 6. Failure reason is recorded
    const validationResult = validator.validate(normalized);
    assert.equal(validationResult.valid, false);
    assert.ok(validationResult.errors.includes("STALE_DATA"));

    // 7. Risk engine receives freshness failure & 8. Risk engine does NOT approve
    const riskResult = riskEngine.evaluate(normalized, validationResult, freshnessResult);
    assert.equal(riskResult.status, "FAIL");
    assert.ok(riskResult.reasonCodes.includes("EXPIRED_DATA_CRITICAL") || riskResult.reasonCodes.includes("STALE_DATA"));

    // 9. No valid settlement authorization is produced
    assert.notEqual(riskResult.status, "PASS");
  });
});
