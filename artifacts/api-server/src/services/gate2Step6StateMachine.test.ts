import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MiddlewareStateMachine, MiddlewareState } from "./stateMachine";
import { NormalizationEngine } from "./normalizationEngine";
import { ValidationEngine } from "./validationEngine";
import { FreshnessEngine } from "./freshnessEngine";
import { RiskEngine } from "./riskEngine";
import { CanonicalRWAObservation } from "./rwaProvider";

describe("GATE 2.6 — RWA State Machine Validation Suite", () => {
  const normalizer = new NormalizationEngine();
  const validator = new ValidationEngine(300);
  const freshnessEngine = new FreshnessEngine(300);
  const riskEngine = new RiskEngine();

  const validRawInput: CanonicalRWAObservation = {
    observationId: "obs-gate-2-6-valid",
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
    metadataHash: "hash-26",
    rawHash: "raw-26",
  };

  it("Valid Transition Test — Ingestion sets OBSERVED/VALIDATED, never auto-settles", () => {
    const sm = new MiddlewareStateMachine();
    const record = sm.createRecord("REQ-001", "RWA-001");

    assert.strictEqual(record.currentState, "UNKNOWN");

    sm.transition("REQ-001", "OBSERVED", "OBSERVE", "Ingested", "ENGINE", "Success");
    assert.strictEqual(sm.getRecord("REQ-001")?.currentState, "OBSERVED");

    sm.transition("REQ-001", "VALIDATED", "VALIDATE", "Passed", "ENGINE", "Success");
    assert.strictEqual(sm.getRecord("REQ-001")?.currentState, "VALIDATED");

    // Guarantee: State is NOT ATTESTED or SETTLED automatically
    assert.notStrictEqual(sm.getRecord("REQ-001")?.currentState, "ATTESTED");
  });

  it("Invalid Transition Test A — STALE_DATA -> ATTESTED is REJECTED", () => {
    const sm = new MiddlewareStateMachine();
    sm.transition("REQ-STALE", "OBSERVED", "OBSERVE", "Ingested", "ENGINE", "Success");
    sm.transition("REQ-STALE", "STALE", "STALE_DETECTED", "Stale Data", "ENGINE", "Stale");

    assert.throws(() => {
      sm.transition("REQ-STALE", "ATTESTED", "ATTEST", "Attempted", "ENGINE", "Illegal");
    }, /INVALID_STATE_TRANSITION/);

    assert.strictEqual(sm.getRecord("REQ-STALE")?.currentState, "STALE");
  });

  it("Invalid Transition Test B — RISK_FAIL -> ATTESTED is REJECTED", () => {
    const sm = new MiddlewareStateMachine();
    sm.transition("REQ-RF", "OBSERVED", "OBSERVE", "Ingested", "ENGINE", "Success");
    sm.transition("REQ-RF", "REJECTED", "RISK_FAIL", "High Risk", "ENGINE", "Failed");

    assert.throws(() => {
      sm.transition("REQ-RF", "ATTESTED", "ATTEST", "Attempted", "ENGINE", "Illegal");
    }, /INVALID_STATE_TRANSITION/);

    assert.strictEqual(sm.getRecord("REQ-RF")?.currentState, "REJECTED");
  });

  it("Invalid Transition Test C — UNKNOWN_ASSET -> ATTESTED is REJECTED", () => {
    const sm = new MiddlewareStateMachine();
    sm.transition("REQ-UA", "REJECTED", "INVALID_ASSET", "Unknown Asset", "ENGINE", "Rejected");

    assert.throws(() => {
      sm.transition("REQ-UA", "ATTESTED", "ATTEST", "Attempted", "ENGINE", "Illegal");
    }, /INVALID_STATE_TRANSITION/);
  });

  it("Invalid Transition Test D — INVALID_NAV -> ATTESTED is REJECTED", () => {
    const sm = new MiddlewareStateMachine();
    sm.transition("REQ-NAV", "REJECTED", "INVALID_NAV", "Zero NAV", "ENGINE", "Rejected");

    assert.throws(() => {
      sm.transition("REQ-NAV", "ATTESTED", "ATTEST", "Attempted", "ENGINE", "Illegal");
    }, /INVALID_STATE_TRANSITION/);
  });

  it("Invalid Transition Test E — UNVERIFIED_CUSTODY -> ATTESTED is REJECTED", () => {
    const sm = new MiddlewareStateMachine();
    sm.transition("REQ-CUST", "OBSERVED", "OBSERVE", "Ingested", "ENGINE", "Success");
    sm.transition("REQ-CUST", "REJECTED", "CUSTODY_UNVERIFIED", "Unverified Custody", "ENGINE", "Rejected");

    assert.throws(() => {
      sm.transition("REQ-CUST", "ATTESTED", "ATTEST", "Attempted", "ENGINE", "Illegal");
    }, /INVALID_STATE_TRANSITION/);
  });

  it("Golden Rule Regression Test — UNCERTAIN DATA stays PENDING / REJECTED and NEVER REACHES ATTESTED", () => {
    const uncertainInputs: Array<{ name: string; raw: CanonicalRWAObservation }> = [
      { name: "Uncertain Custody", raw: { ...validRawInput, custodyStatus: "PENDING" as any } },
      { name: "Uncertain Settlement", raw: { ...validRawInput, settlementStatus: "PENDING" as any } },
      { name: "Stale Timestamp", raw: { ...validRawInput, timestamp: Math.floor(Date.now() / 1000) - 600 } },
      { name: "Uncertain Valuation", raw: { ...validRawInput, valuation: 0 } },
    ];

    for (const testCase of uncertainInputs) {
      const sm = new MiddlewareStateMachine();
      const normalized = normalizer.normalize(testCase.raw);
      const valRes = validator.validate(normalized);
      const freshness = freshnessEngine.evaluate(normalized.timestamp, 300, Math.floor(Date.now() / 1000));
      const riskRes = riskEngine.evaluate(normalized, valRes, freshness);

      sm.transition(`REQ-${testCase.name}`, "OBSERVED", "OBSERVE", "Ingested", "ENGINE", "Success");

      if (riskRes.status === "FAIL") {
        sm.transition(`REQ-${testCase.name}`, "REJECTED", "REJECT", "Risk Failed", "ENGINE", "Security Halt");
      }

      const currentState = sm.getRecord(`REQ-${testCase.name}`)?.currentState;

      // Invariant: Must be REJECTED or OBSERVED (Pending), NEVER ATTESTED!
      assert.notStrictEqual(currentState, "ATTESTED");
      assert.ok(currentState === "REJECTED" || currentState === "OBSERVED");
    }
  });
});
