import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NormalizationEngine } from "./normalizationEngine.js";
import { ValidationEngine } from "./validationEngine.js";
import { FreshnessEngine } from "./freshnessEngine.js";
import { RiskEngine } from "./riskEngine.js";
import { MiddlewareStateMachine } from "./stateMachine.js";
import { AttestationService } from "./attestationService.js";

describe("GATE 6.1 — Failure Demonstration Baseline Validation Suite", () => {
  it("Validates fresh baseline (Age: 2m, NAV: $1M, Yield: 5.2%, Custody: VERIFIED)", async () => {
    const normalizer = new NormalizationEngine();
    const validator = new ValidationEngine(600); // 10 minutes max age threshold
    const freshnessEngine = new FreshnessEngine(600); // 10 minutes max age threshold
    const riskEngine = new RiskEngine();
    const stateMachine = new MiddlewareStateMachine();
    const attester = new AttestationService();

    const now = Math.floor(Date.now() / 1000);
    const dataAgeSeconds = 120; // 2 minutes old
    const observationTimestamp = now - dataAgeSeconds;

    const rawExternalData = {
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

    // 1. Normalization
    const normalized = normalizer.normalize(rawExternalData);
    assert.equal(normalized.assetId, "RWA-001");
    assert.equal(normalized.nav, 1000000);
    assert.equal(normalized.yieldRate, 5.2);
    assert.equal(normalized.custodyStatus, "VERIFIED");

    // 2. Schema & Business Validation
    const validationResult = validator.validate(normalized);
    assert.equal(validationResult.valid, true);

    // 3. Freshness Check (Threshold: 600s, Age: 120s)
    const freshnessResult = freshnessEngine.evaluate(normalized.timestamp, 600);
    assert.equal(freshnessResult.freshnessStatus, "FRESH");
    assert.equal(freshnessResult.isAttestable, true);
    assert.equal(freshnessResult.ageSeconds, 120);

    // 4. Risk Engine Evaluation
    const riskResult = riskEngine.evaluate(normalized, validationResult, freshnessResult);
    assert.equal(riskResult.status, "PASS");
    assert.equal(riskResult.riskScore, 0);

    // 5. State Machine & Attestation Generation
    stateMachine.createRecord("REQ-0001", "RWA-001");
    stateMachine.transition("REQ-0001", "OBSERVED", "DATA_RECEIVED", "Fresh RWA Data", "System");
    stateMachine.transition("REQ-0001", "VALIDATED", "VALIDATED_PASS", "Schema Validated", "System");
    stateMachine.transition("REQ-0001", "ATTESTABLE", "RISK_PASS", "Risk Engine Pass", "System");

    const record = stateMachine.getRecord("REQ-0001");
    assert.equal(record?.currentState, "ATTESTABLE");

    const attestation = await attester.generateAttestation(
      "RWA-001",
      "REQ-0001",
      "SETTLED",
      1000000,
      5.2,
      true
    );
    assert.ok(attestation.signature);
    assert.equal(attestation.payload.requestId, "REQ-0001");
    assert.equal(attestation.payload.assetId, "RWA-001");
  });
});
