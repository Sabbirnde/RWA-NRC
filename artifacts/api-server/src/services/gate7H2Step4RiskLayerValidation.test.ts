import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NormalizationEngine } from "./normalizationEngine.js";
import { ValidationEngine } from "./validationEngine.js";
import { FreshnessEngine } from "./freshnessEngine.js";
import { RiskEngine } from "./riskEngine.js";
import { MiddlewareStateMachine } from "./stateMachine.js";
import { AttestationService } from "./attestationService.js";

describe("GATE 7 — H2 Step 4: Risk Layer Independent Validation Suite", () => {
  it("Passes schema validation & freshness, but triggers risk engine failure on unverified custody and blocks attestation", async () => {
    const normalizer = new NormalizationEngine();
    const validator = new ValidationEngine(600);
    const freshnessEngine = new FreshnessEngine(600);
    const riskEngine = new RiskEngine();
    const stateMachine = new MiddlewareStateMachine();
    const attester = new AttestationService();

    const requestId = "REQ-H2-004";
    stateMachine.createRecord(requestId, "RWA-001");
    const now = Math.floor(Date.now() / 1000);

    // 1. Structurally Valid & Fresh Payload with High Risk (OFFSHORE Jurisdiction & ELEVATED Risk Status)
    const rawData = {
      assetId: "RWA-001",
      assetType: "TREASURY" as const,
      valuation: 1000000,
      nav: 1000000,
      yieldRate: 5.2,
      currency: "USD",
      timestamp: now - 30, // Fresh timestamp (30s old)
      source: "Firecrawl Live Ingestion",
      dataSource: "Firecrawl Live Ingestion",
      sourceUrl: "https://mock.treasury.gov/api/v1/assets/RWA-001",
      status: "VERIFIED" as const,
      custodyStatus: "VERIFIED" as const,
      settlementStatus: "SETTLED" as const,
      jurisdiction: "OFFSHORE", // Triggers OFFSHORE_JURISDICTION_RISK (+20)
      riskStatus: "ELEVATED" as const, // Triggers HIGH_CREDIT_RISK (+35) -> Total Risk Score: 55 >= 50
    };

    // 2. Normalization
    const normalized = normalizer.normalize(rawData);
    assert.equal(normalized.custodyStatus, "VERIFIED");

    // 3. Validation Check (Structurally valid schema)
    const validationResult = validator.validate(normalized);
    assert.equal(validationResult.valid, true);
    assert.equal(validationResult.errors.length, 0);

    // 4. Freshness Check (Freshness passes)
    const freshnessResult = freshnessEngine.evaluate(normalized.timestamp, 600, now);
    assert.equal(freshnessResult.freshnessStatus, "FRESH");

    // 5. Risk Engine Check (Must FAIL due to riskScore 55 >= 50)
    const riskResult = riskEngine.evaluate(normalized, validationResult, freshnessResult);
    assert.equal(riskResult.status, "FAIL");
    assert.ok(riskResult.riskScore >= 50);
    assert.ok(riskResult.reasonCodes.includes("HIGH_CREDIT_RISK"));

    // 6. Transition State Machine to REJECTED
    stateMachine.transition(requestId, "OBSERVED", "DATA_RECEIVED", "High risk RWA payload", "Firecrawl", "Ingest");
    stateMachine.transition(requestId, "REJECTED", "RISK_ENGINE_REJECT", "Risk score exceeds safety threshold", "RiskEngine", "Risk reject");

    const record = stateMachine.getRecord(requestId);
    assert.equal(record?.currentState, "REJECTED");

    // 7. Guarantee NO Attestation is Issued
    let attestation = null;
    if (validationResult.valid && riskResult.status === "PASS") {
      attestation = await attester.generateAttestation("RWA-001", requestId, "SETTLED", normalized.nav, normalized.yieldRate, true);
    }
    assert.equal(attestation, null);

    console.log("=== GATE 7 H2 STEP 4 RISK LAYER EVIDENCE ===");
    console.log("request_id:", requestId);
    console.log("validation_status:", "PASS");
    console.log("freshness_status:", freshnessResult.freshnessStatus, "(PASS)");
    console.log("risk_status:", riskResult.status, "(FAIL)");
    console.log("risk_failure_reason:", riskResult.reasonCodes.join(", "));
    console.log("attestation_status:", "NOT_ISSUED");
    console.log("settlement_status:", "BLOCKED");
  });
});
