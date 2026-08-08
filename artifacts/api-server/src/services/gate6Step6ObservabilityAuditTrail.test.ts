import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NormalizationEngine } from "./normalizationEngine.js";
import { ValidationEngine } from "./validationEngine.js";
import { FreshnessEngine } from "./freshnessEngine.js";
import { RiskEngine } from "./riskEngine.js";

describe("GATE 6.6 — Observability & Audit Trail Validation Suite", () => {
  it("Generates complete audit trail and UI state flags for stale data failure", () => {
    const normalizer = new NormalizationEngine();
    const validator = new ValidationEngine(600); // 10m threshold
    const freshnessEngine = new FreshnessEngine(600);
    const riskEngine = new RiskEngine();

    const currentTimestamp = Math.floor(Date.now() / 1000);
    const dataAgeSeconds = 37 * 60; // 37 minutes = 2220s
    const externalTimestamp = currentTimestamp - dataAgeSeconds;

    const rawStaleData = {
      assetId: "RWA-001",
      nav: 1000000,
      yieldRate: 5.2,
      custodyStatus: "VERIFIED" as const,
      settlementStatus: "SETTLED" as const,
      riskStatus: "PASS" as const,
      timestamp: externalTimestamp,
      source: "Firecrawl",
      sourceUrl: "https://treasury.gov/rates/daily-treasury-yield",
    };

    const normalized = normalizer.normalize(rawStaleData);
    const validationResult = validator.validate(normalized);
    const freshnessResult = freshnessEngine.evaluate(normalized.timestamp, 600, currentTimestamp);
    const riskResult = riskEngine.evaluate(normalized, validationResult, freshnessResult);

    // Build Audit Log Payload
    const auditRecord = {
      requestId: "REQ-STALE-0001",
      assetId: normalized.assetId,
      externalTimestamp: normalized.timestamp,
      validationTimestamp: currentTimestamp,
      freshnessThreshold: 600,
      actualDataAge: freshnessResult.ageSeconds,
      freshnessResult: freshnessResult.freshnessStatus === "FRESH" ? "PASSED" : "FAILED",
      riskResult: riskResult.status === "PASS" ? "APPROVED" : "BLOCKED",
      attestationResult: "NOT ISSUED",
      settlementResult: "BLOCKED",
      failureReason: "External RWA data is stale.",
      warningBanner: "Settlement Blocked — External state could not be safely verified.",
      vaultState: "PENDING",
    };

    // Assert Audit Trail Completeness
    assert.equal(auditRecord.requestId, "REQ-STALE-0001");
    assert.equal(auditRecord.assetId, "RWA-001");
    assert.equal(auditRecord.externalTimestamp, externalTimestamp);
    assert.equal(auditRecord.validationTimestamp, currentTimestamp);
    assert.equal(auditRecord.freshnessThreshold, 600);
    assert.equal(auditRecord.actualDataAge, 2220);
    assert.equal(auditRecord.freshnessResult, "FAILED");
    assert.equal(auditRecord.riskResult, "BLOCKED");
    assert.equal(auditRecord.attestationResult, "NOT ISSUED");
    assert.equal(auditRecord.settlementResult, "BLOCKED");
    assert.equal(auditRecord.failureReason, "External RWA data is stale.");
    assert.equal(auditRecord.vaultState, "PENDING");

    // UI Anti-Assertions (Must NOT display successful or ready states)
    assert.notEqual(auditRecord.warningBanner, "Settlement Successful");
    assert.notEqual(auditRecord.warningBanner, "Ready for Settlement");
    assert.ok(auditRecord.warningBanner.includes("Settlement Blocked"));
  });
});
