import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FirecrawlProvider } from "./rwaProvider.js";
import { NormalizationEngine } from "./normalizationEngine.js";
import { ValidationEngine } from "./validationEngine.js";
import { FreshnessEngine } from "./freshnessEngine.js";
import { RiskEngine } from "./riskEngine.js";
import { MiddlewareStateMachine } from "./stateMachine.js";

describe("GATE 7 — H1 Step 5: External RWA Verification Dependency Suite", () => {
  it("Ingests, normalizes, validates, checks freshness, and evaluates risk for RWA-001 without vault mutation", async () => {
    const firecrawl = new FirecrawlProvider();
    const normalizer = new NormalizationEngine();
    const validator = new ValidationEngine(600); // 10m threshold
    const freshnessEngine = new FreshnessEngine(600);
    const riskEngine = new RiskEngine();
    const stateMachine = new MiddlewareStateMachine();

    const requestId = "REQ-0001";
    stateMachine.createRecord(requestId, "RWA-001");

    // 1. Raw Data Ingestion
    const now = Math.floor(Date.now() / 1000);
    const rawObs = await firecrawl.getAssetState("RWA-001", "valid");
    assert.ok(rawObs);
    assert.equal(rawObs.assetId, "RWA-001");
    stateMachine.transition(requestId, "OBSERVED", "DATA_RECEIVED", "Raw RWA Data Ingested", "FirecrawlProvider", "Ingest");

    // 2. Normalization
    const normalized = normalizer.normalize(rawObs);
    assert.equal(normalized.assetId, "RWA-001");
    assert.ok(normalized.nav >= 1000000);
    assert.equal(normalized.yieldRate, 5.2);
    assert.equal(normalized.custodyStatus, "VERIFIED");

    // 3. Schema & Business Validation
    const validationResult = validator.validate(normalized);
    assert.equal(validationResult.valid, true);
    assert.equal(validationResult.errors.length, 0);
    stateMachine.transition(requestId, "VALIDATED", "VALIDATED_PASS", "Schema Validated", "ValidationEngine", "Validate");

    // 4. Freshness Check
    const freshnessResult = freshnessEngine.evaluate(normalized.timestamp, 600, now);
    assert.equal(freshnessResult.freshnessStatus, "FRESH");
    assert.equal(freshnessResult.isAttestable, true);

    // 5. Risk Engine Evaluation
    const riskResult = riskEngine.evaluate(normalized, validationResult, freshnessResult);
    assert.equal(riskResult.status, "PASS");
    assert.ok(riskResult.riskScore < 50);
    stateMachine.transition(requestId, "ATTESTABLE", "RISK_PASS", "Risk Engine Approved", "RiskEngine", "Approve");

    // 6. Final Middleware State Verification (No Vault Call / No Minting)
    const finalRecord = stateMachine.getRecord(requestId);
    assert.equal(finalRecord?.currentState, "ATTESTABLE");

    const bigIntReplacer = (k: string, v: any) => (typeof v === "bigint" ? v.toString() : v);

    console.log("=== GATE 7 STEP 5 MIDDLEWARE CAPTURE ===");
    console.log("1. Raw Data:", JSON.stringify(rawObs, bigIntReplacer));
    console.log("2. Normalized Data:", JSON.stringify(normalized, bigIntReplacer));
    console.log("3. Validation Result:", JSON.stringify(validationResult, bigIntReplacer));
    console.log("4. Freshness Result:", JSON.stringify(freshnessResult, bigIntReplacer));
    console.log("5. Risk Result:", JSON.stringify(riskResult, bigIntReplacer));
    console.log("6. Final Middleware State:", finalRecord?.currentState);
  });
});
