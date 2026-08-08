import { MockRWAProvider, FirecrawlProvider } from "./rwaProvider";
import { ValidationEngine } from "./validationEngine";
import { RiskEngine } from "./riskEngine";
import { AttestationService } from "./attestationService";

async function runMiddlewarePipelineTests() {
  console.log("Testing RWA Middleware Pipeline...");

  const mockProvider = new MockRWAProvider();
  const firecrawlProvider = new FirecrawlProvider();
  const validator = new ValidationEngine(900); // 15m
  const riskEngine = new RiskEngine();
  const attestationService = new AttestationService();

  // Test 1: Valid Ingestion & Validation
  const validState = await mockProvider.getAssetState("RWA-001");
  const valResult = validator.validate(validState);
  if (!valResult.valid) {
    throw new Error(`Expected valid state, got errors: ${valResult.errors.join(", ")}`);
  }

  // Test 2: Risk Evaluation PASS
  const riskResult = riskEngine.evaluate(validState, valResult);
  if (riskResult.status !== "PASS") {
    throw new Error(`Expected PASS risk status, got ${riskResult.status}`);
  }

  // Test 3: EIP-712 Attestation Signing
  const attestation = await attestationService.generateAttestation(
    validState.assetId,
    "REQ-0001",
    "SETTLED",
    validState.nav,
    validState.yieldRate,
    true
  );
  if (!attestation.signature || !attestation.signer) {
    throw new Error("Failed to generate EIP-712 attestation signature");
  }

  // Test 4: Stale Data Rejection
  const staleState = { ...validState, timestamp: Math.floor(Date.now() / 1000) - 1800 }; // 30m old
  const staleVal = validator.validate(staleState);
  if (staleVal.valid) {
    throw new Error("Expected stale data to fail validation");
  }
  const staleRisk = riskEngine.evaluate(staleState, staleVal);
  if (staleRisk.status !== "FAIL" || !staleRisk.reasons.includes("STALE_DATA")) {
    throw new Error("Expected FAIL risk status with STALE_DATA reason");
  }

  // Test 5: Unverified Custody Rejection
  const unverifiedState = { ...validState, custodyStatus: "UNVERIFIED" as const };
  const unverifiedVal = validator.validate(unverifiedState);
  const unverifiedRisk = riskEngine.evaluate(unverifiedState, unverifiedVal);
  if (unverifiedRisk.status !== "FAIL" || !unverifiedRisk.reasons.includes("CUSTODY_NOT_VERIFIED")) {
    throw new Error("Expected FAIL risk status with CUSTODY_NOT_VERIFIED reason");
  }

  // Test 6: Multi-Failure Risk Evaluation (STALE_DATA + CUSTODY_NOT_VERIFIED)
  const multiFailState = {
    ...validState,
    timestamp: Math.floor(Date.now() / 1000) - 1800,
    custodyStatus: "UNVERIFIED" as const,
  };
  const multiVal = validator.validate(multiFailState);
  const multiRisk = riskEngine.evaluate(multiFailState, multiVal);
  if (
    multiRisk.status !== "FAIL" ||
    !multiRisk.reasons.includes("STALE_DATA") ||
    !multiRisk.reasons.includes("CUSTODY_NOT_VERIFIED")
  ) {
    throw new Error("Expected FAIL risk status with both STALE_DATA and CUSTODY_NOT_VERIFIED reasons");
  }

  console.log("✅ All RWA Middleware Pipeline Tests Passed Successfully!");
}

runMiddlewarePipelineTests().catch((err) => {
  console.error("❌ Middleware test failed:", err);
  process.exit(1);
});
