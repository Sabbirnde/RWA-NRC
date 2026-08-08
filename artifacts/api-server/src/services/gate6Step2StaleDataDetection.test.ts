import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NormalizationEngine } from "./normalizationEngine.js";
import { ValidationEngine } from "./validationEngine.js";
import { FreshnessEngine } from "./freshnessEngine.js";
import { RiskEngine } from "./riskEngine.js";

describe("GATE 6.2 — Stale Data Detection Simulation Suite", () => {
  it("Detects intentionally stale RWA data (Age: 37m, Threshold: 10m)", () => {
    const normalizer = new NormalizationEngine();
    const validator = new ValidationEngine(600); // 10 minutes max age threshold (600s)
    const freshnessEngine = new FreshnessEngine(600); // 10 minutes max age threshold
    const riskEngine = new RiskEngine();

    const now = Math.floor(Date.now() / 1000);
    const dataAgeSeconds = 37 * 60; // 37 minutes = 2220 seconds
    const observationTimestamp = now - dataAgeSeconds;

    const rawStaleData = {
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

    // 1. Normalization (Data remains structurally valid)
    const normalized = normalizer.normalize(rawStaleData);
    assert.equal(normalized.assetId, "RWA-001");
    assert.equal(normalized.nav, 1000000);
    assert.equal(normalized.timestamp, observationTimestamp);

    // 2. Validation Engine Check (Flags STALE_DATA)
    const validationResult = validator.validate(normalized);
    assert.equal(validationResult.valid, false);
    assert.ok(validationResult.errors.includes("STALE_DATA"));

    // 3. Freshness Check (Threshold: 600s, Age: 2220s)
    const freshnessResult = freshnessEngine.evaluate(normalized.timestamp, 600, now);
    assert.equal(freshnessResult.freshnessStatus, "EXPIRED");
    assert.equal(freshnessResult.isAttestable, false);
    assert.equal(freshnessResult.ageSeconds, 2220);

    // 4. Risk Engine Evaluation (Escalates to FAIL / CRITICAL)
    const riskResult = riskEngine.evaluate(normalized, validationResult, freshnessResult);
    assert.equal(riskResult.status, "FAIL");
    assert.ok(riskResult.riskScore >= 50);
  });
});
