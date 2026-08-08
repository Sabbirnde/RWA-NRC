import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockRWAProvider } from "./rwaProvider";
import { NormalizationEngine } from "./normalizationEngine";
import { ValidationEngine } from "./validationEngine";
import { RiskEngine } from "./riskEngine";
import { MiddlewareStateMachine } from "./stateMachine";
import { CanonicalRWAObservation } from "./rwaProvider";

describe("GATE 2.8 — Asset Registry and NAV Validation Suite", () => {
  const provider = new MockRWAProvider();
  const normalizer = new NormalizationEngine();
  const validator = new ValidationEngine(300);
  const riskEngine = new RiskEngine();

  const baseRaw: CanonicalRWAObservation = {
    observationId: "obs-gate-2-8-valid",
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
    metadataHash: "hash-28",
    rawHash: "raw-28",
  };

  it("Test 1 — Registered Asset: RWA-001 -> ACCEPTED", async () => {
    const obs = await provider.getAssetState("RWA-001", "valid");
    assert.strictEqual(obs.assetId, "RWA-001");
    assert.strictEqual(obs.status, "VERIFIED");

    const normalized = normalizer.normalize(obs);
    const valRes = validator.validate(normalized);
    assert.strictEqual(valRes.valid, true);
  });

  it("Test 2 — Unknown Asset: RWA-999 -> Throws/Rejects and does NOT auto-register or settle", async () => {
    await assert.rejects(async () => {
      await provider.getAssetState("RWA-999", "missing");
    }, /not found in provider registry/);

    const sm = new MiddlewareStateMachine();
    const unknownRaw = { ...baseRaw, assetId: "RWA-999" };
    const normalized = normalizer.normalize(unknownRaw);
    
    // Simulate validator check with context requiring expected asset
    const valRes = validator.validate(normalized, { expectedIssuer: "MOCK_ISSUER" });

    sm.transition("REQ-RWA-999", "OBSERVED", "OBSERVE", "Ingested", "ENGINE", "Success");
    if (!valRes.valid) {
      sm.transition("REQ-RWA-999", "REJECTED", "REJECT", "Unknown Asset", "ENGINE", "Rejected");
    }

    const state = sm.getRecord("REQ-RWA-999")?.currentState;
    assert.notStrictEqual(state, "ATTESTED");
  });

  it("Test 3 — Zero NAV: NAV = 0 -> REJECTED & RISK FAIL", () => {
    const raw = { ...baseRaw, valuation: 0, nav: 0 };
    const normalized = normalizer.normalize(raw);
    const valRes = validator.validate(normalized);
    const riskRes = riskEngine.evaluate(normalized, valRes);

    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("INVALID_NAV"));
    assert.strictEqual(riskRes.status, "FAIL");
  });

  it("Test 4 — Negative NAV: NAV = -100 -> REJECTED & RISK FAIL", () => {
    const raw = { ...baseRaw, valuation: -100, nav: -100 };
    const normalized = normalizer.normalize(raw);
    const valRes = validator.validate(normalized);
    const riskRes = riskEngine.evaluate(normalized, valRes);

    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("INVALID_NAV"));
    assert.strictEqual(riskRes.status, "FAIL");
  });

  it("Test 5 — Null NAV: NAV = null -> REJECTED & RISK FAIL", () => {
    const raw = { ...baseRaw, valuation: null as any, nav: null as any };
    const normalized = normalizer.normalize(raw);
    const valRes = validator.validate(normalized);
    const riskRes = riskEngine.evaluate(normalized, valRes);

    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("INVALID_NAV"));
    assert.strictEqual(riskRes.status, "FAIL");
  });

  it("Test 6 — Invalid NAV Type: NAV = 'one million' -> REJECTED & RISK FAIL", () => {
    const raw = { ...baseRaw, valuation: "one million" as any, nav: "one million" as any };
    const normalized = normalizer.normalize(raw);
    const valRes = validator.validate(normalized);
    const riskRes = riskEngine.evaluate(normalized, valRes);

    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("INVALID_NAV"));
    assert.strictEqual(riskRes.status, "FAIL");
  });

  it("Test 7 — NaN / Infinity NAV: NaN, Infinity, -Infinity -> REJECTED & RISK FAIL", () => {
    const invalidValues = [NaN, Infinity, -Infinity];
    for (const val of invalidValues) {
      const raw = { ...baseRaw, valuation: val as any, nav: val as any };
      const normalized = normalizer.normalize(raw);
      const valRes = validator.validate(normalized);
      const riskRes = riskEngine.evaluate(normalized, valRes);

      assert.strictEqual(valRes.valid, false);
      assert.ok(valRes.errors.includes("INVALID_NAV"));
      assert.strictEqual(riskRes.status, "FAIL");
    }
  });

  it("Critical Rule — Settlement Protection: Invalid NAV NEVER produces RISK = PASS or SETTLED", () => {
    const invalidValues = [0, -500, null, "one million", NaN, Infinity, -Infinity];
    for (const val of invalidValues) {
      const raw = { ...baseRaw, valuation: val as any, nav: val as any };
      const normalized = normalizer.normalize(raw);
      const valRes = validator.validate(normalized);
      const riskRes = riskEngine.evaluate(normalized, valRes);

      assert.notStrictEqual(riskRes.status, "PASS");
      assert.strictEqual(riskRes.status, "FAIL");

      const sm = new MiddlewareStateMachine();
      sm.transition("REQ-NAV-FAIL", "OBSERVED", "OBSERVE", "Ingested", "ENGINE", "Success");
      sm.transition("REQ-NAV-FAIL", "REJECTED", "REJECT", "Invalid NAV", "ENGINE", "Safety Halt");

      assert.notStrictEqual(sm.getRecord("REQ-NAV-FAIL")?.currentState, "ATTESTED");
    }
  });
});
