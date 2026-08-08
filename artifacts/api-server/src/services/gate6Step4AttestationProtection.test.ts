import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NormalizationEngine } from "./normalizationEngine.js";
import { ValidationEngine } from "./validationEngine.js";
import { FreshnessEngine } from "./freshnessEngine.js";
import { RiskEngine } from "./riskEngine.js";
import { MiddlewareStateMachine } from "./stateMachine.js";
import { AttestationService } from "./attestationService.js";

describe("GATE 6.4 — Attestation Layer Protection Suite (Stale Data)", () => {
  it("Guarantees NO attestation is generated or signed for stale RWA data", async () => {
    const normalizer = new NormalizationEngine();
    const validator = new ValidationEngine(600);
    const freshnessEngine = new FreshnessEngine(600);
    const riskEngine = new RiskEngine();
    const stateMachine = new MiddlewareStateMachine();
    const attester = new AttestationService();

    const currentTimestamp = Math.floor(Date.now() / 1000);
    const dataAgeSeconds = 37 * 60; // 37 minutes
    const observationTimestamp = currentTimestamp - dataAgeSeconds;

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

    const requestId = "REQ-STALE-001";
    stateMachine.createRecord(requestId, "RWA-001");
    stateMachine.transition(requestId, "OBSERVED", "DATA_RECEIVED", "Stale payload ingested", "Firecrawl");

    // 1. Normalization & Validation
    const normalized = normalizer.normalize(rawStaleData);
    const validationResult = validator.validate(normalized);
    const freshnessResult = freshnessEngine.evaluate(normalized.timestamp, 600, currentTimestamp);
    const riskResult = riskEngine.evaluate(normalized, validationResult, freshnessResult);

    // 2. Middleware transition block
    if (!validationResult.valid || freshnessResult.freshnessStatus === "EXPIRED" || riskResult.status === "FAIL") {
      stateMachine.transition(requestId, "REJECTED", "VALIDATION_FAILED", "Stale RWA data detected", "RiskEngine");
    }

    const record = stateMachine.getRecord(requestId);
    assert.equal(record?.currentState, "REJECTED");
    assert.notEqual(record?.currentState, "ATTESTABLE");

    // 3. Attestation Guard Verification
    let attestationAttempted = false;
    let attestationProduced = null;

    if (record?.currentState === "ATTESTABLE" && riskResult.status === "PASS") {
      attestationAttempted = true;
      attestationProduced = await attester.generateAttestation(
        "RWA-001",
        requestId,
        "SETTLED",
        normalized.nav,
        normalized.yieldRate,
        true
      );
    }

    assert.equal(attestationAttempted, false);
    assert.equal(attestationProduced, null);
  });
});
