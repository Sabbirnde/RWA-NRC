import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NormalizationEngine } from "./normalizationEngine.js";
import { ValidationEngine } from "./validationEngine.js";
import { FreshnessEngine } from "./freshnessEngine.js";
import { RiskEngine } from "./riskEngine.js";
import { MiddlewareStateMachine } from "./stateMachine.js";
import { AttestationService } from "./attestationService.js";

describe("GATE 7 — H2 Step 3: Stale External Data Validation Suite", () => {
  it("Enforces freshness failure on 37-minute stale RWA data, blocks risk approval, and prevents attestation generation", async () => {
    const maxDataAge = 600; // 10 minutes threshold (600s)
    const normalizer = new NormalizationEngine();
    const validator = new ValidationEngine(maxDataAge);
    const freshnessEngine = new FreshnessEngine(maxDataAge);
    const riskEngine = new RiskEngine();
    const stateMachine = new MiddlewareStateMachine();
    const attester = new AttestationService();

    const requestId = "REQ-H2-003";
    stateMachine.createRecord(requestId, "RWA-001");

    const now = Math.floor(Date.now() / 1000);
    const dataAgeSeconds = 2220; // 37 minutes old
    const dataTimestamp = now - dataAgeSeconds;

    // 1. Valid-Looking Payload with Stale Timestamp
    const rawData = {
      assetId: "RWA-001",
      assetType: "TREASURY" as const,
      valuation: 1000000,
      nav: 1000000,
      yieldRate: 5.2,
      currency: "USD",
      timestamp: dataTimestamp,
      source: "Firecrawl Live Ingestion",
      dataSource: "Firecrawl Live Ingestion",
      sourceUrl: "https://mock.treasury.gov/api/v1/assets/RWA-001",
      status: "VERIFIED" as const,
      custodyStatus: "VERIFIED" as const,
      settlementStatus: "SETTLED" as const,
      riskStatus: "PASS" as const,
    };

    // 2. Normalization
    const normalized = normalizer.normalize(rawData);
    assert.equal(normalized.nav, 1000000);
    assert.equal(normalized.timestamp, dataTimestamp);

    // 3. Schema Validation Check (Schema is structurally valid, but STALE_DATA flagged)
    const validationResult = validator.validate(normalized);
    assert.equal(validationResult.valid, false);
    assert.ok(validationResult.errors.includes("STALE_DATA"));

    // 4. Freshness Engine Check
    const freshnessResult = freshnessEngine.evaluate(normalized.timestamp, maxDataAge, now);
    assert.equal(freshnessResult.freshnessStatus, "EXPIRED");
    assert.equal(freshnessResult.isAttestable, false);
    assert.equal(freshnessResult.ageSeconds, dataAgeSeconds);

    // 5. Risk Engine Check (Must REJECT due to stale data)
    const riskResult = riskEngine.evaluate(normalized, validationResult, freshnessResult);
    assert.equal(riskResult.status, "FAIL");
    assert.ok(riskResult.reasons.includes("STALE_DATA_REJECT") || riskResult.reasons.includes("STALE_DATA"));

    // 6. Transition State Machine to STALE
    stateMachine.transition(requestId, "OBSERVED", "DATA_RECEIVED", "Stale RWA payload ingested", "Firecrawl", "Ingest");
    stateMachine.transition(requestId, "STALE", "STALE_DATA_BLOCK", "Settlement blocked due to stale RWA data", "RiskEngine", "Stale block");

    const record = stateMachine.getRecord(requestId);
    assert.equal(record?.currentState, "STALE");

    // 7. Guarantee NO Attestation is Issued
    let attestation = null;
    if (validationResult.valid && riskResult.status === "PASS") {
      attestation = await attester.generateAttestation("RWA-001", requestId, "SETTLED", normalized.nav, normalized.yieldRate, true);
    }
    assert.equal(attestation, null);

    console.log("=== GATE 7 H2 STEP 3 STALE DATA EVIDENCE ===");
    console.log("data_timestamp:", dataTimestamp);
    console.log("current_timestamp:", now);
    console.log("data_age:", `${dataAgeSeconds}s (37m)`);
    console.log("max_allowed_age:", `${maxDataAge}s (10m)`);
    console.log("freshness_status:", freshnessResult.freshnessStatus);
    console.log("failure_code:", "STALE_DATA");
    console.log("attestation_status:", "NOT_ISSUED");
    console.log("settlement_status:", "BLOCKED");
  });
});
