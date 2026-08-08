import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { NormalizationEngine } from "./normalizationEngine.js";
import { ValidationEngine } from "./validationEngine.js";
import { FreshnessEngine } from "./freshnessEngine.js";
import { RiskEngine } from "./riskEngine.js";
import { MiddlewareStateMachine } from "./stateMachine.js";
import { AttestationService } from "./attestationService.js";

describe("GATE 6 — Final Failure Demonstration & Boundary Test Suite", () => {
  const normalizer = new NormalizationEngine();
  const validator = new ValidationEngine(600); // 10m threshold (600s)
  const freshnessEngine = new FreshnessEngine(600);
  const riskEngine = new RiskEngine();
  const stateMachine = new MiddlewareStateMachine();
  const attester = new AttestationService();

  it("Executes Complete Phase 1 (Healthy) -> Phase 2 (Stale Failure) -> Phase 3 (Recovery) Lifecycle", async () => {
    const requestId = "REQ-GATE6-CYCLE";
    stateMachine.createRecord(requestId, "RWA-001");
    const now = Math.floor(Date.now() / 1000);

    // --- PHASE 1: HEALTHY (Age 2m) ---
    const rawP1 = {
      assetId: "RWA-001",
      nav: 1000000,
      yieldRate: 5.2,
      custodyStatus: "VERIFIED" as const,
      settlementStatus: "SETTLED" as const,
      riskStatus: "PASS" as const,
      timestamp: now - 120,
      source: "Firecrawl",
      sourceUrl: "https://treasury.gov/rates/daily-treasury-yield",
    };
    const normP1 = normalizer.normalize(rawP1);
    const valP1 = validator.validate(normP1);
    const freshP1 = freshnessEngine.evaluate(normP1.timestamp, 600, now);
    const riskP1 = riskEngine.evaluate(normP1, valP1, freshP1);

    assert.equal(freshP1.freshnessStatus, "FRESH");
    assert.equal(riskP1.status, "PASS");
    stateMachine.transition(requestId, "OBSERVED", "DATA", "P1", "Ingest", "Ingest");
    stateMachine.transition(requestId, "VALIDATED", "VAL", "P1", "Val", "Val");
    stateMachine.transition(requestId, "ATTESTABLE", "RISK", "P1", "Risk", "Risk");
    const attP1 = await attester.generateAttestation("RWA-001", requestId, "SETTLED", normP1.nav, normP1.yieldRate, true);
    assert.ok(attP1.signature);

    // --- PHASE 2: FAILURE (Age 37m) ---
    const rawP2 = { ...rawP1, timestamp: now - 2220 };
    const normP2 = normalizer.normalize(rawP2);
    const valP2 = validator.validate(normP2);
    const freshP2 = freshnessEngine.evaluate(normP2.timestamp, 600, now);
    const riskP2 = riskEngine.evaluate(normP2, valP2, freshP2);

    assert.equal(freshP2.freshnessStatus, "EXPIRED");
    assert.equal(riskP2.status, "FAIL");
    stateMachine.transition(requestId, "STALE", "STALE", "P2", "Risk", "Stale block");
    assert.equal(stateMachine.getRecord(requestId)?.currentState, "STALE");

    // --- PHASE 3: RECOVERY (Age 2m) ---
    const rawP3 = { ...rawP1, timestamp: now - 120 };
    const normP3 = normalizer.normalize(rawP3);
    const valP3 = validator.validate(normP3);
    const freshP3 = freshnessEngine.evaluate(normP3.timestamp, 600, now);
    const riskP3 = riskEngine.evaluate(normP3, valP3, freshP3);

    assert.equal(freshP3.freshnessStatus, "FRESH");
    assert.equal(riskP3.status, "PASS");
    stateMachine.transition(requestId, "OBSERVED", "DATA", "P3", "Ingest", "Ingest");
    stateMachine.transition(requestId, "VALIDATED", "VAL", "P3", "Val", "Val");
    stateMachine.transition(requestId, "ATTESTABLE", "RISK", "P3", "Risk", "Risk");
    const attP3 = await attester.generateAttestation("RWA-001", requestId, "SETTLED", normP3.nav, normP3.yieldRate, true);
    assert.ok(attP3.signature);
  });

  it("TEST A: Data age = 11 minutes (660s > 600s threshold) -> Expected FAIL", () => {
    const now = Math.floor(Date.now() / 1000);
    const ts = now - 660; // 11 minutes old
    const fresh = freshnessEngine.evaluate(ts, 600, now);
    assert.equal(fresh.freshnessStatus, "STALE");
    assert.equal(fresh.isAttestable, false);

    const norm = normalizer.normalize({ assetId: "RWA-001", nav: 1000000, timestamp: ts, source: "Firecrawl", sourceUrl: "https://t.gov" });
    const val = validator.validate(norm);
    assert.equal(val.valid, false);
    assert.ok(val.errors.includes("STALE_DATA"));
  });

  it("TEST B: Data age = exactly 10 minutes (600s == 600s threshold) -> Expected AGING (Attestable)", () => {
    const now = Math.floor(Date.now() / 1000);
    const ts = now - 600; // Exactly 10 minutes old
    const fresh = freshnessEngine.evaluate(ts, 600, now);
    assert.equal(fresh.freshnessStatus, "AGING");
    assert.equal(fresh.isAttestable, true);

    const norm = normalizer.normalize({ assetId: "RWA-001", nav: 1000000, custodyStatus: "VERIFIED" as const, settlementStatus: "SETTLED" as const, riskStatus: "PASS" as const, timestamp: ts, source: "Firecrawl", sourceUrl: "https://t.gov" });
    const val = validator.validate(norm);
    assert.equal(val.valid, true);
  });

  it("TEST C: Data age = 2 minutes (120s < 600s threshold) -> Expected PASS", () => {
    const now = Math.floor(Date.now() / 1000);
    const ts = now - 120; // 2 minutes old
    const fresh = freshnessEngine.evaluate(ts, 600, now);
    assert.equal(fresh.freshnessStatus, "FRESH");
    assert.equal(fresh.isAttestable, true);
  });

  it("TEST D: Missing timestamp (undefined) -> Expected FAIL", () => {
    const norm = normalizer.normalize({ assetId: "RWA-001", nav: 1000000, source: "Firecrawl", sourceUrl: "https://t.gov" });
    const val = validator.validate(norm);
    assert.equal(val.valid, false);
    assert.ok(val.errors.includes("INVALID_TIMESTAMP"));
  });

  it("TEST E: Invalid timestamp (-1) -> Expected FAIL", () => {
    const norm = normalizer.normalize({ assetId: "RWA-001", nav: 1000000, timestamp: -1, source: "Firecrawl", sourceUrl: "https://t.gov" });
    const val = validator.validate(norm);
    assert.equal(val.valid, false);
    assert.ok(val.errors.includes("INVALID_TIMESTAMP"));
  });

  it("TEST F: Future timestamp (now + 600s) -> Expected FAIL", () => {
    const now = Math.floor(Date.now() / 1000);
    const norm = normalizer.normalize({ assetId: "RWA-001", nav: 1000000, timestamp: now + 600, source: "Firecrawl", sourceUrl: "https://t.gov" });
    const val = validator.validate(norm);
    assert.equal(val.valid, false);
    assert.ok(val.errors.includes("INVALID_TIMESTAMP"));
  });
});
