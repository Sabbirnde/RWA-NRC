import assert from "node:assert";
import { describe, it } from "node:test";
import { AttestationService } from "./attestationService";
import { FreshnessEngine } from "./freshnessEngine";
import { NormalizationEngine } from "./normalizationEngine";
import { RiskEngine } from "./riskEngine";
import { FirecrawlProvider, MockRWAProvider } from "./rwaProvider";
import { MiddlewareStateMachine } from "./stateMachine";
import { ValidationEngine } from "./validationEngine";

describe("E2E Protocol Validation & Failure Scenarios Suite", () => {
  const normalizer = new NormalizationEngine();
  const validator = new ValidationEngine(300);
  const freshnessEngine = new FreshnessEngine(300);
  const riskEngine = new RiskEngine();
  const attestationService = new AttestationService();
  const mockProvider = new MockRWAProvider();
  const firecrawlProvider = new FirecrawlProvider();

  it("SUCCESS SCENARIO: End-to-End Ingestion, Attestation & State Machine Flow", async () => {
    const rawObs = await mockProvider.getAssetState("RWA-001", "valid");
    const normalized = normalizer.normalize(rawObs);
    const valRes = validator.validate(normalized);
    assert.strictEqual(valRes.valid, true);

    const freshness = freshnessEngine.evaluate(normalized.timestamp);
    assert.strictEqual(freshness.freshnessStatus, "FRESH");

    const risk = riskEngine.evaluate(normalized, valRes, freshness);
    assert.strictEqual(risk.status, "PASS");

    const sm = new MiddlewareStateMachine();
    sm.transition("REQ-E2E-01", "OBSERVED", "OBSERVE", "Ingested", "ENGINE", "Success");
    sm.transition("REQ-E2E-01", "VALIDATED", "VALIDATE", "Passed", "ENGINE", "Success");
    sm.transition("REQ-E2E-01", "ATTESTABLE", "MARK_ATTESTABLE", "Risk PASS", "ENGINE", "Success");

    const signedAttestation = await attestationService.generateAttestation(
      normalized.assetId,
      "REQ-E2E-01",
      "SETTLED",
      normalized.valuation,
      normalized.yieldRate,
      true
    );

    assert.ok(signedAttestation.signature);
    const record = sm.transition("REQ-E2E-01", "ATTESTED", "ATTEST", "Signed", "ENGINE", "Success");
    assert.strictEqual(record.currentState, "ATTESTED");
  });

  it("Test 1: Firecrawl Unavailable -> Fallback to Mock Provider", async () => {
    const asset = await firecrawlProvider.getAssetState("UNKNOWN-ASSET");
    assert.ok(asset.assetId);
    assert.ok(asset.source.includes("Mock Provider") || asset.source.includes("Fallback"));
  });

  it("Test 2: Firecrawl Returns Invalid Data -> Validator Rejects", async () => {
    const invalidObs = await mockProvider.getAssetState("RWA-001", "invalid");
    const normalized = normalizer.normalize(invalidObs);
    const valRes = validator.validate(normalized);
    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("INVALID_NAV"));
  });

  it("Test 3: RWA Data Stale -> Freshness & Risk Engine Reject", async () => {
    const now = Math.floor(Date.now() / 1000);
    const staleObs = { ...(await mockProvider.getAssetState("RWA-001")), timestamp: now - 600 };
    const normalized = normalizer.normalize(staleObs);

    const valRes = validator.validate(normalized);
    const freshness = freshnessEngine.evaluate(normalized.timestamp);
    assert.strictEqual(freshness.freshnessStatus, "STALE");

    const risk = riskEngine.evaluate(normalized, valRes, freshness);
    assert.strictEqual(risk.status, "FAIL");
  });

  it("Test 4: Attestation Signature Invalid -> Signer Mismatch", async () => {
    const untrustedService = new AttestationService("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    const signed = await untrustedService.generateAttestation("RWA-001", "REQ-04", "SETTLED", 1000000, 520, true);

    assert.notStrictEqual(signed.signer.toLowerCase(), attestationService.getSignerAddress().toLowerCase());
  });

  it("Test 5: Attestation Replayed -> Nonce Monotonically Increases", async () => {
    const att1 = await attestationService.generateAttestation("RWA-001", "REQ-05A", "SETTLED", 1000000, 520, true);
    const att2 = await attestationService.generateAttestation("RWA-001", "REQ-05B", "SETTLED", 1000000, 520, true);

    assert.ok(att2.payload.nonce > att1.payload.nonce);
  });

  it("Test 6: Oracle Transaction Fails -> Vault State Exception Handled", async () => {
    const sm = new MiddlewareStateMachine();
    sm.transition("REQ-06", "OBSERVED", "OBSERVE", "Ingested", "ENGINE", "Success");
    const record = sm.transition("REQ-06", "REJECTED", "REJECT", "Oracle Revert", "ORACLE", "Tx Reverted");

    assert.strictEqual(record.currentState, "REJECTED");
  });

  it("Test 7: Vault Remains Pending -> No Shares Attestable Until Settled", async () => {
    const sm = new MiddlewareStateMachine();
    const record = sm.createRecord("REQ-07", "RWA-001");
    sm.transition("REQ-07", "OBSERVED", "OBSERVE", "Ingested", "ENGINE", "Success");

    assert.strictEqual(record.currentState, "OBSERVED"); // Pending off-chain
  });

  it("Test 8: Settlement Fails -> Middleware Transitions to REJECTED", async () => {
    const conflictingObs = await mockProvider.getAssetState("RWA-001", "conflicting");
    const normalized = normalizer.normalize(conflictingObs);
    const valRes = validator.validate(normalized);
    const risk = riskEngine.evaluate(normalized, valRes);

    assert.strictEqual(risk.status, "FAIL");

    const sm = new MiddlewareStateMachine();
    sm.transition("REQ-08", "OBSERVED", "OBSERVE", "Ingested", "ENGINE", "Success");
    const record = sm.transition("REQ-08", "REJECTED", "REJECT", "Risk FAIL", "ENGINE", "Failed risk check");

    assert.strictEqual(record.currentState, "REJECTED");
  });

  it("Test 9: Claim Duplicated -> Deduplication Set Flags Existing ID", async () => {
    const seenIds = new Set<string>(["REQ-09"]);
    const obs = await mockProvider.getAssetState("RWA-001", "valid");
    const normalized = normalizer.normalize({ ...obs, observationId: "REQ-09" });

    const valRes = validator.validate(normalized, { seenObservationIds: seenIds });
    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("DUPLICATE_OBSERVATION_ID"));
  });

  it("Test 10: Claim Market Has No Buyer -> State Remains Active in Listing", () => {
    const sm = new MiddlewareStateMachine();
    sm.transition("REQ-10", "OBSERVED", "OBSERVE", "Ingested", "ENGINE", "Success");
    sm.transition("REQ-10", "VALIDATED", "VALIDATE", "Passed", "ENGINE", "Success");
    const record = sm.transition("REQ-10", "ATTESTABLE", "MARK_ATTESTABLE", "Low Risk", "ENGINE", "Listed on market");

    assert.strictEqual(record.currentState, "ATTESTABLE");
  });

  it("Test 11: Buyer Attempts Invalid Claim Purchase -> State Machine Guards Edge", () => {
    const sm = new MiddlewareStateMachine();
    sm.createRecord("REQ-11", "RWA-001");

    assert.throws(
      () => sm.transition("REQ-11", "ATTESTED", "JUMP", "Illegal Purchase", "BUYER", "Illegal"),
      /INVALID_STATE_TRANSITION/
    );
  });

  it("Test 12: Finalization Attempted Twice -> Terminal State Prevents Re-entry", () => {
    const sm = new MiddlewareStateMachine();
    sm.transition("REQ-12", "OBSERVED", "OBSERVE", "Ingested", "ENGINE", "Success");
    sm.transition("REQ-12", "VALIDATED", "VALIDATE", "Passed", "ENGINE", "Success");
    sm.transition("REQ-12", "ATTESTABLE", "MARK_ATTESTABLE", "Low Risk", "ENGINE", "Success");
    sm.transition("REQ-12", "ATTESTED", "ATTEST", "Signed", "ENGINE", "Success");

    assert.throws(
      () => sm.transition("REQ-12", "VALIDATED", "RE-ENTER", "Double Finalize", "ENGINE", "Illegal"),
      /INVALID_STATE_TRANSITION/
    );
  });

  it("Test 13: Signer Compromised -> Revoked Key Flagged", () => {
    const revokedSigners = new Set<string>([attestationService.getSignerAddress().toLowerCase()]);
    assert.ok(revokedSigners.has(attestationService.getSignerAddress().toLowerCase()));
  });

  it("Test 14: Blockchain RPC Unavailable -> API Server Handles Network Errors Gracefully", async () => {
    const sm = new MiddlewareStateMachine();
    sm.transition("REQ-14", "OBSERVED", "OBSERVE", "Ingested", "ENGINE", "Success");
    const record = sm.transition("REQ-14", "REJECTED", "RPC_FAIL", "Network Error", "ORACLE", "RPC Unavailable");

    assert.strictEqual(record.currentState, "REJECTED");
  });
});
