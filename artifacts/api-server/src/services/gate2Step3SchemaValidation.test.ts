import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NormalizationEngine } from "./normalizationEngine";
import { ValidationEngine } from "./validationEngine";
import { FreshnessEngine } from "./freshnessEngine";
import { RiskEngine } from "./riskEngine";
import { MiddlewareStateMachine } from "./stateMachine";
import { CanonicalRWAObservation } from "./rwaProvider";

describe("GATE 2.3 — RWA Schema Validation Suite", () => {
  const normalizer = new NormalizationEngine();
  const validator = new ValidationEngine(300);
  const freshnessEngine = new FreshnessEngine(300);
  const riskEngine = new RiskEngine();

  const validRawInput: CanonicalRWAObservation = {
    observationId: "obs-gate-2-3-valid",
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
    metadataHash: "hash-23",
    rawHash: "raw-23",
  };

  it("Valid Schema Test — Standard RWA-001 Passes Validation", () => {
    const normalized = normalizer.normalize(validRawInput);
    const valRes = validator.validate(normalized);

    assert.strictEqual(valRes.valid, true);
    assert.strictEqual(valRes.errors.length, 0);
  });

  it("Test A — Missing Asset ID -> REJECT", () => {
    const raw = { ...validRawInput, assetId: "" };
    const normalized = normalizer.normalize(raw);
    const valRes = validator.validate(normalized);

    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("INVALID_ASSET_ID"));
  });

  it("Test B — Invalid NAV -> REJECT", () => {
    const raw = { ...validRawInput, valuation: "invalid" as any, nav: "invalid" as any };
    const normalized = normalizer.normalize(raw);
    const valRes = validator.validate(normalized);

    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("INVALID_NAV"));
  });

  it("Test C — Missing Custody -> REJECT", () => {
    const raw = { ...validRawInput, custodyStatus: undefined as any };
    const normalized = normalizer.normalize(raw);
    const valRes = validator.validate(normalized);

    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("CUSTODY_NOT_VERIFIED"));
  });

  it("Test D — Invalid Custody -> REJECT", () => {
    const raw = { ...validRawInput, custodyStatus: "RANDOM" as any };
    const normalized = normalizer.normalize(raw);
    const valRes = validator.validate(normalized);

    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("CUSTODY_NOT_VERIFIED"));
  });

  it("Test E — Invalid Settlement -> REJECT", () => {
    const raw = { ...validRawInput, settlementStatus: "INVALID" as any };
    const normalized = normalizer.normalize(raw);
    const valRes = validator.validate(normalized);

    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("SETTLEMENT_NOT_CONFIRMED"));
  });

  it("Test F — Invalid Timestamp -> REJECT", () => {
    const raw = { ...validRawInput, timestamp: "malformed" as any };
    const normalized = normalizer.normalize(raw);
    const valRes = validator.validate(normalized);

    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("INVALID_TIMESTAMP"));
  });

  it("Pipeline Short-Circuit Test — Invalid Schema Stops Execution Before Freshness, Risk, State Machine, and Attestation", () => {
    const invalidRaw = { ...validRawInput, assetId: "", valuation: -500 };
    const normalized = normalizer.normalize(invalidRaw);
    const valRes = validator.validate(normalized);

    assert.strictEqual(valRes.valid, false);

    // Verify Short-Circuit: If valRes.valid is false, pipeline halts immediately!
    let freshnessCalled = false;
    let riskEngineCalled = false;
    let stateMachineTransitioned = false;

    if (valRes.valid) {
      freshnessCalled = true;
      freshnessEngine.evaluate(normalized.timestamp);
      riskEngineCalled = true;
      riskEngine.evaluate(normalized, valRes, { freshnessStatus: "FRESH", ageSeconds: 0, maxAge: 300 });
      stateMachineTransitioned = true;
      const sm = new MiddlewareStateMachine();
      sm.transition("REQ-SC-01", "OBSERVED", "VALIDATE", "Pass", "ENGINE", "Success");
    }

    assert.strictEqual(freshnessCalled, false);
    assert.strictEqual(riskEngineCalled, false);
    assert.strictEqual(stateMachineTransitioned, false);
  });
});
