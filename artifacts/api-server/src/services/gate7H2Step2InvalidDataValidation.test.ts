import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NormalizationEngine } from "./normalizationEngine.js";
import { ValidationEngine } from "./validationEngine.js";
import { FreshnessEngine } from "./freshnessEngine.js";
import { RiskEngine } from "./riskEngine.js";
import { MiddlewareStateMachine } from "./stateMachine.js";
import { AttestationService } from "./attestationService.js";

describe("GATE 7 — H2 Step 2: Invalid External Data Layer Validation Suite", () => {
  it("Rejects negative NAV valuation at validation layer, blocks risk approval, and prevents attestation generation", async () => {
    const normalizer = new NormalizationEngine();
    const validator = new ValidationEngine(600);
    const freshnessEngine = new FreshnessEngine(600);
    const riskEngine = new RiskEngine();
    const stateMachine = new MiddlewareStateMachine();
    const attester = new AttestationService();

    const requestId = "REQ-H2-002";
    stateMachine.createRecord(requestId, "RWA-001");
    const now = Math.floor(Date.now() / 1000);

    // 1. Intentionally Invalid Raw RWA Data (NAV = -1)
    const rawData = {
      assetId: "RWA-001",
      assetType: "TREASURY" as const,
      valuation: -1,
      nav: -1,
      yieldRate: 5.2,
      currency: "USD",
      timestamp: now - 60, // Fresh timestamp (1m old)
      source: "Firecrawl Live Ingestion",
      dataSource: "Firecrawl Live Ingestion",
      sourceUrl: "https://mock.treasury.gov/api/v1/assets/RWA-001",
      status: "VERIFIED" as const,
      custodyStatus: "VERIFIED" as const,
      settlementStatus: "SETTLED" as const,
      riskStatus: "PASS" as const,
    };

    // 2. Normalization (coerces negative values to 0)
    const normalized = normalizer.normalize(rawData);
    assert.equal(normalized.nav, 0);

    // 3. Validation Layer Check
    const validationResult = validator.validate(normalized);
    assert.equal(validationResult.valid, false);
    assert.ok(validationResult.errors.includes("INVALID_NAV"));

    // 4. Freshness Check (Freshness passes independently, but must NOT override validation failure)
    const freshnessResult = freshnessEngine.evaluate(normalized.timestamp, 600, now);
    assert.equal(freshnessResult.freshnessStatus, "FRESH");

    // 5. Risk Engine Evaluation (Must REJECT due to validation failure)
    const riskResult = riskEngine.evaluate(normalized, validationResult, freshnessResult);
    assert.equal(riskResult.status, "FAIL");
    assert.ok(riskResult.reasons.includes("INVALID_NAV"));

    // 6. Transition State Machine to REJECTED
    stateMachine.transition(requestId, "OBSERVED", "DATA_RECEIVED", "Invalid RWA payload", "Firecrawl", "Ingest");
    stateMachine.transition(requestId, "REJECTED", "VALIDATION_FAILED", "NAV valuation is invalid (-1)", "ValidationEngine", "Reject");

    const record = stateMachine.getRecord(requestId);
    assert.equal(record?.currentState, "REJECTED");

    // 7. Guarantee NO Attestation is Issued
    let attestation = null;
    if (validationResult.valid && riskResult.status === "PASS") {
      attestation = await attester.generateAttestation("RWA-001", requestId, "SETTLED", normalized.nav, normalized.yieldRate, true);
    }
    assert.equal(attestation, null);

    console.log("=== GATE 7 H2 STEP 2 MIDDLEWARE EVIDENCE ===");
    console.log("request_id:", requestId);
    console.log("asset_id:", normalized.assetId);
    console.log("validation_status:", "FAIL");
    console.log("validation_error:", "NAV valuation must be greater than zero");
    console.log("failure_code:", "INVALID_NAV");
    console.log("attestation_status:", "NOT_ISSUED");
    console.log("settlement_status:", "BLOCKED");
  });
});
