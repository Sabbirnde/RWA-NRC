import assert from "node:assert";
import { describe, it } from "node:test";
import { AttestationService } from "./attestationService";
import { RiskEngine } from "./riskEngine";
import { FirecrawlProvider, MockRWAProvider } from "./rwaProvider";
import { ValidationEngine } from "./validationEngine";

describe("RWA Middleware Pipeline", () => {
  const mockProvider = new MockRWAProvider();
  const firecrawlProvider = new FirecrawlProvider();
  const validator = new ValidationEngine(900); // 15m
  const riskEngine = new RiskEngine();
  const attestationService = new AttestationService();

  it("Test 1: Valid Ingestion & Validation", async () => {
    const validState = await mockProvider.getAssetState("RWA-001");
    const valResult = validator.validate(validState as any);
    assert.strictEqual(valResult.valid, true);
  });

  it("Test 2: Risk Evaluation PASS", async () => {
    const validState = await mockProvider.getAssetState("RWA-001");
    const valResult = validator.validate(validState as any);
    const riskResult = riskEngine.evaluate(validState as any, valResult);
    assert.strictEqual(riskResult.status, "PASS");
  });

  it("Test 3: EIP-712 Attestation Signing", async () => {
    const validState = await mockProvider.getAssetState("RWA-001");
    const attestation = await attestationService.generateAttestation(
      validState.assetId,
      "REQ-0001",
      "SETTLED",
      validState.valuation,
      validState.yieldRate,
      true
    );
    assert.ok(attestation.signature);
    assert.ok(attestation.signer);
  });

  it("Test 4: Stale Data Rejection", async () => {
    const validState = await mockProvider.getAssetState("RWA-001");
    const staleState = { ...validState, timestamp: Math.floor(Date.now() / 1000) - 1800 };
    const staleVal = validator.validate(staleState as any);
    assert.strictEqual(staleVal.valid, false);
    const staleRisk = riskEngine.evaluate(staleState as any, staleVal);
    assert.strictEqual(staleRisk.status, "FAIL");
    assert.ok(staleRisk.reasons.includes("STALE_DATA"));
  });
});
