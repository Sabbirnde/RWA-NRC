import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FreshnessEngine } from "./freshnessEngine";
import { ValidationEngine } from "./validationEngine";
import { RiskEngine } from "./riskEngine";
import { MiddlewareStateMachine } from "./stateMachine";
import { NormalizationEngine } from "./normalizationEngine";
import { CanonicalRWAObservation } from "./rwaProvider";

describe("GATE 2.4 — RWA Freshness Validation Suite", () => {
  const freshnessEngine = new FreshnessEngine(300);
  const validator = new ValidationEngine(300);
  const normalizer = new NormalizationEngine();
  const riskEngine = new RiskEngine();

  const validRawInput: CanonicalRWAObservation = {
    observationId: "obs-gate-2-4-fresh",
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
    metadataHash: "hash-24",
    rawHash: "raw-24",
  };

  it("Test 1 — Fresh Data: Timestamp = CURRENT returns FRESH and isAttestable = true", () => {
    const now = Math.floor(Date.now() / 1000);
    const evalResult = freshnessEngine.evaluate(now);

    assert.strictEqual(evalResult.freshnessStatus, "FRESH");
    assert.strictEqual(evalResult.isAttestable, true);
  });

  it("Test 2 — Stale Data: Timestamp > 300s old returns STALE and isAttestable = false", () => {
    const now = Math.floor(Date.now() / 1000);
    const staleTime = now - 350; // > 300s max age
    const evalResult = freshnessEngine.evaluate(staleTime, 300, now);

    assert.strictEqual(evalResult.freshnessStatus, "STALE");
    assert.strictEqual(evalResult.isAttestable, false);
  });

  it("Test 3 — Missing Timestamp: Timestamp = 0 is rejected and NOT FRESH", () => {
    const raw = { ...validRawInput, timestamp: 0 };
    const normalized = normalizer.normalize(raw);
    const valRes = validator.validate(normalized);

    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("INVALID_TIMESTAMP"));

    const evalResult = freshnessEngine.evaluate(0);
    assert.notStrictEqual(evalResult.freshnessStatus, "FRESH");
    assert.strictEqual(evalResult.isAttestable, false);
  });

  it("Test 4 — Future Timestamp: Timestamp > now + 300s is rejected", () => {
    const now = Math.floor(Date.now() / 1000);
    const futureTime = now + 1000; // 1000s in future
    const raw = { ...validRawInput, timestamp: futureTime };
    const normalized = normalizer.normalize(raw);
    const valRes = validator.validate(normalized);

    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("INVALID_TIMESTAMP"));
  });

  it("Critical Safety Test — STALE_DATA is NEVER SETTLED (Risk Engine FAIL & State Machine REJECTED)", () => {
    const now = Math.floor(Date.now() / 1000);
    const staleTime = now - 400; // 400s old
    const raw = { ...validRawInput, timestamp: staleTime };
    const normalized = normalizer.normalize(raw);
    const valRes = validator.validate(normalized);

    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("STALE_DATA"));

    const freshnessEval = freshnessEngine.evaluate(staleTime, 300, now);
    assert.strictEqual(freshnessEval.isAttestable, false);

    const riskEval = riskEngine.evaluate(normalized, valRes, freshnessEval);
    assert.strictEqual(riskEval.status, "FAIL");
    assert.ok(riskEval.reasons.includes("STALE_DATA"));

    const sm = new MiddlewareStateMachine();
    sm.transition("REQ-STALE-01", "OBSERVED", "OBSERVE", "Ingested", "ENGINE", "Success");
    sm.transition("REQ-STALE-01", "REJECTED", "REJECT", "Stale Data", "ENGINE", "Failure");

    assert.strictEqual(sm.getRecord("REQ-STALE-01")?.currentState, "REJECTED");
  });
});
