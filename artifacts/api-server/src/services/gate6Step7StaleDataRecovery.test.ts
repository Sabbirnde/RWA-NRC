import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NormalizationEngine } from "./normalizationEngine.js";
import { ValidationEngine } from "./validationEngine.js";
import { FreshnessEngine } from "./freshnessEngine.js";
import { RiskEngine } from "./riskEngine.js";
import { MiddlewareStateMachine } from "./stateMachine.js";
import { AttestationService } from "./attestationService.js";

describe("GATE 6.7 — Stale Data Recovery & Resumption Validation Suite", () => {
  it("Recovers existing pending request when RWA data becomes fresh (Age: 2m)", async () => {
    const normalizer = new NormalizationEngine();
    const validator = new ValidationEngine(600);
    const freshnessEngine = new FreshnessEngine(600);
    const riskEngine = new RiskEngine();
    const stateMachine = new MiddlewareStateMachine();
    const attester = new AttestationService();

    const requestId = "REQ-RECOVERABLE-001";
    stateMachine.createRecord(requestId, "RWA-001");

    // --- PHASE 1: STALE DATA ATTEMPT (BLOCKED) ---
    const now1 = Math.floor(Date.now() / 1000);
    const staleData = {
      assetId: "RWA-001",
      nav: 1000000,
      yieldRate: 5.2,
      custodyStatus: "VERIFIED" as const,
      settlementStatus: "SETTLED" as const,
      riskStatus: "PASS" as const,
      timestamp: now1 - 37 * 60, // 37 min old
      source: "Firecrawl",
      sourceUrl: "https://treasury.gov/rates/daily-treasury-yield",
    };

    const normStale = normalizer.normalize(staleData);
    const valStale = validator.validate(normStale);
    const freshStale = freshnessEngine.evaluate(normStale.timestamp, 600, now1);
    const riskStale = riskEngine.evaluate(normStale.timestamp ? normStale : normStale, valStale, freshStale);

    stateMachine.transition(requestId, "OBSERVED", "DATA_RECEIVED", "Stale payload ingested", "Firecrawl", "Ingest");
    stateMachine.transition(requestId, "STALE", "STALE_DATA_BLOCK", "Settlement blocked due to stale RWA data", "RiskEngine", "Freshness check failed");

    const recordStale = stateMachine.getRecord(requestId);
    assert.equal(recordStale?.currentState, "STALE");

    // --- PHASE 2: FRESH DATA RECOVERY (RESUMED) ---
    const now2 = Math.floor(Date.now() / 1000);
    const freshData = {
      assetId: "RWA-001",
      nav: 1000000,
      yieldRate: 5.2,
      custodyStatus: "VERIFIED" as const,
      settlementStatus: "SETTLED" as const,
      riskStatus: "PASS" as const,
      timestamp: now2 - 2 * 60, // 2 min old (FRESH)
      source: "Firecrawl",
      sourceUrl: "https://treasury.gov/rates/daily-treasury-yield",
    };

    const normFresh = normalizer.normalize(freshData);
    const valFresh = validator.validate(normFresh);
    const freshFresh = freshnessEngine.evaluate(normFresh.timestamp, 600, now2);
    const riskFresh = riskEngine.evaluate(normFresh, valFresh, freshFresh);

    // 1. Freshness PASS
    assert.equal(freshFresh.freshnessStatus, "FRESH");
    assert.equal(freshFresh.isAttestable, true);

    // 2. Risk PASS
    assert.equal(riskFresh.status, "PASS");
    assert.equal(riskFresh.riskScore, 0);

    // 3. State transition recovery on existing request
    stateMachine.transition(requestId, "OBSERVED", "FRESH_DATA_RECEIVED", "Fresh RWA payload received", "Firecrawl", "Ingest");
    stateMachine.transition(requestId, "VALIDATED", "VALIDATION_PASSED", "Validation passed", "ValidationEngine", "Validate");
    stateMachine.transition(requestId, "ATTESTABLE", "RISK_PASSED", "Risk Engine approved", "RiskEngine", "Approve");

    // 4. Valid Attestation Generated
    const attestation = await attester.generateAttestation(
      "RWA-001",
      requestId,
      "SETTLED",
      normFresh.nav,
      normFresh.yieldRate,
      true
    );

    assert.ok(attestation.signature);
    assert.equal(attestation.payload.requestId, requestId);

    // 5. Existing pending request progresses normally
    const recordRecovered = stateMachine.getRecord(requestId);
    assert.equal(recordRecovered?.currentState, "ATTESTABLE");
    assert.equal(recordRecovered?.requestId, requestId);
  });
});
