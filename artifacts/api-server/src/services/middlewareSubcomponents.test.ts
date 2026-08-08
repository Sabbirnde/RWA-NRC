import assert from "node:assert";
import { describe, it } from "node:test";
import { FreshnessEngine } from "./freshnessEngine";
import { NormalizationEngine } from "./normalizationEngine";
import { RiskEngine } from "./riskEngine";
import { MockRWAProvider } from "./rwaProvider";
import { MiddlewareStateMachine } from "./stateMachine";
import { ValidationEngine } from "./validationEngine";

describe("RWA Middleware Sub-Components Suite", () => {
  const normalizer = new NormalizationEngine();
  const validator = new ValidationEngine(300); // 5m
  const freshnessEngine = new FreshnessEngine(300);
  const riskEngine = new RiskEngine();
  const mockProvider = new MockRWAProvider();

  it("1. Valid Observation -> Full Pipeline Pass", async () => {
    const rawObs = await mockProvider.getAssetState("RWA-001", "valid");
    const normalized = normalizer.normalize(rawObs);

    assert.strictEqual(normalized.assetId, "RWA-001");
    assert.strictEqual(normalized.valuation, 1002500);
    assert.strictEqual(normalized.decimals, 6);
    assert.ok(normalized.metadataHash);

    const valRes = validator.validate(normalized);
    assert.strictEqual(valRes.valid, true);

    const freshness = freshnessEngine.evaluate(normalized.timestamp);
    assert.strictEqual(freshness.freshnessStatus, "FRESH");

    const risk = riskEngine.evaluate(normalized, valRes, freshness);
    assert.strictEqual(risk.riskLevel, "LOW");
    assert.strictEqual(risk.status, "PASS");

    const sm = new MiddlewareStateMachine();
    sm.transition("REQ-01", "OBSERVED", "OBSERVE", "Ingested", "ENGINE", "Success");
    sm.transition("REQ-01", "VALIDATED", "VALIDATE", "Passed checklist", "ENGINE", "Success");
    const record = sm.transition("REQ-01", "ATTESTABLE", "MARK_ATTESTABLE", "Fresh & Low Risk", "ENGINE", "Success");

    assert.strictEqual(record.currentState, "ATTESTABLE");
    assert.strictEqual(record.history.length, 3);
  });

  it("2. Invalid Schema -> Fails Validation", async () => {
    const rawObs = await mockProvider.getAssetState("RWA-001", "invalid");
    const normalized = normalizer.normalize(rawObs);

    const valRes = validator.validate(normalized);
    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("INVALID_NAV"));

    const sm = new MiddlewareStateMachine();
    sm.transition("REQ-02", "OBSERVED", "OBSERVE", "Ingested", "ENGINE", "Success");
    const record = sm.transition("REQ-02", "REJECTED", "REJECT", "Invalid Schema", "ENGINE", "Failed validation");

    assert.strictEqual(record.currentState, "REJECTED");
  });

  it("3. Stale Data -> Freshness STALE", async () => {
    const now = Math.floor(Date.now() / 1000);
    const staleObs = { ...(await mockProvider.getAssetState("RWA-001")), timestamp: now - 600 }; // 10m old (300s < age <= 900s)
    const normalized = normalizer.normalize(staleObs);

    const freshness = freshnessEngine.evaluate(normalized.timestamp);
    assert.strictEqual(freshness.freshnessStatus, "STALE");
    assert.strictEqual(freshness.isAttestable, false);

    const sm = new MiddlewareStateMachine();
    sm.transition("REQ-03", "OBSERVED", "OBSERVE", "Ingested", "ENGINE", "Success");
    const record = sm.transition("REQ-03", "STALE", "EXPIRE", "Age > 300s", "ENGINE", "Stale data");

    assert.strictEqual(record.currentState, "STALE");
  });

  it("4. Expired Data -> Freshness EXPIRED", async () => {
    const now = Math.floor(Date.now() / 1000);
    const expiredObs = { ...(await mockProvider.getAssetState("RWA-001")), timestamp: now - 1200 }; // 20m old (>900s)
    const normalized = normalizer.normalize(expiredObs);

    const freshness = freshnessEngine.evaluate(normalized.timestamp);
    assert.strictEqual(freshness.freshnessStatus, "EXPIRED");
    assert.strictEqual(freshness.isAttestable, false);
  });

  it("5. Duplicate Data -> Fails Duplicate Check", async () => {
    const obs = await mockProvider.getAssetState("RWA-001", "valid");
    const normalized = normalizer.normalize(obs);

    const seenIds = new Set<string>([normalized.observationId]);
    const valRes = validator.validate(normalized, { seenObservationIds: seenIds });

    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("DUPLICATE_OBSERVATION_ID"));
  });

  it("6. High-Risk Asset -> Risk Engine FAIL", async () => {
    const rawObs = await mockProvider.getAssetState("RWA-001", "conflicting");
    const normalized = normalizer.normalize(rawObs);

    const valRes = validator.validate(normalized);
    const risk = riskEngine.evaluate(normalized, valRes);

    assert.strictEqual(risk.status, "FAIL");
    assert.ok(risk.riskScore >= 50);
    assert.ok(risk.reasonCodes.includes("CUSTODY_UNVERIFIED"));
  });

  it("7. Conflicting Source -> Rejects Untrusted Source", async () => {
    const obs = await mockProvider.getAssetState("RWA-001", "valid");
    const normalized = normalizer.normalize({ ...obs, source: "Malicious Fake Provider" });

    const valRes = validator.validate(normalized);
    const risk = riskEngine.evaluate(normalized, valRes);

    assert.strictEqual(risk.status, "FAIL");
    assert.ok(risk.reasonCodes.includes("UNTRUSTED_SOURCE_PROVIDER"));
  });

  it("8. Invalid State Transition -> Throws Exception", () => {
    const sm = new MiddlewareStateMachine();
    sm.createRecord("REQ-08", "RWA-001");

    assert.throws(
      () => sm.transition("REQ-08", "ATTESTED", "ILLEGAL_JUMP", "Direct Jump", "ENGINE", "Illegal"),
      /INVALID_STATE_TRANSITION/
    );
  });

  it("9. Repeated Transition on Terminal State -> Throws Exception", () => {
    const sm = new MiddlewareStateMachine();
    sm.transition("REQ-09", "OBSERVED", "OBSERVE", "Ingested", "ENGINE", "Success");
    sm.transition("REQ-09", "VALIDATED", "VALIDATE", "Passed", "ENGINE", "Success");
    sm.transition("REQ-09", "ATTESTABLE", "MARK_ATTESTABLE", "Low Risk", "ENGINE", "Success");
    sm.transition("REQ-09", "ATTESTED", "ATTEST", "Signed", "ENGINE", "Success");

    // ATTESTED is terminal
    assert.throws(
      () => sm.transition("REQ-09", "VALIDATED", "REVERSE", "Try Repeat", "ENGINE", "Repeat"),
      /INVALID_STATE_TRANSITION/
    );
  });
});
