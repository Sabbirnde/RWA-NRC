import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NormalizationEngine } from "./normalizationEngine";
import { ValidationEngine } from "./validationEngine";
import { FreshnessEngine } from "./freshnessEngine";
import { RiskEngine } from "./riskEngine";
import { MiddlewareStateMachine } from "./stateMachine";
import { FirecrawlProvider, CanonicalRWAObservation } from "./rwaProvider";

describe("Gate 4.5 — Middleware Processing (Normalize, Validate, Freshness, Risk, SM)", () => {
  const normalizer = new NormalizationEngine();
  const validator = new ValidationEngine(300);
  const freshnessEngine = new FreshnessEngine(300);
  const riskEngine = new RiskEngine();

  it("Test 1 — Full 15-Rule Validation Sweep on Alice RWA-001 Raw External Payload", async () => {
    const firecrawl = new FirecrawlProvider();
    const rawObs: CanonicalRWAObservation = await firecrawl.getAssetState("RWA-001", "valid");

    // 1. Normalize
    const normalized = normalizer.normalize(rawObs);
    assert.strictEqual(normalized.assetId, "RWA-001");
    assert.ok(normalized.nav >= 1000000);
    assert.strictEqual(normalized.custodyStatus, "VERIFIED");

    // 2. Validate
    const valRes = validator.validate(normalized);
    assert.strictEqual(valRes.valid, true);
    assert.strictEqual(valRes.errors.length, 0);

    // 3. Freshness Check
    const freshness = freshnessEngine.evaluate(normalized.timestamp);
    assert.strictEqual(freshness.freshnessStatus, "FRESH");
    assert.strictEqual(freshness.isAttestable, true);

    // 4. Risk Engine
    const risk = riskEngine.evaluate(normalized, valRes, freshness);
    assert.strictEqual(risk.status, "PASS");
    assert.strictEqual(risk.riskScore, 0);
    assert.strictEqual(risk.reasonCodes.length, 0);

    // 5. State Machine Transition Check -> ELIGIBLE_FOR_ATTESTATION
    const sm = new MiddlewareStateMachine();
    sm.createRecord("REQ-0001", "RWA-001");
    sm.transition("REQ-0001", "OBSERVED", "RAW_INGESTION", "Payload received", "FIRECRAWL", "Ingest");
    sm.transition("REQ-0001", "VALIDATED", "VALIDATION_SWEEP", "15 rules passed", "ENGINE", "Validate");
    const record = sm.transition("REQ-0001", "ATTESTABLE", "RISK_SWEEP", "Risk PASS & Fresh", "ENGINE", "Evaluate");

    assert.strictEqual(record.currentState, "ATTESTABLE");
  });
});
