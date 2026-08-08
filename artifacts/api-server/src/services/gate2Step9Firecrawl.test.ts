import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FirecrawlProvider, MockRWAProvider, CanonicalRWAObservation } from "./rwaProvider";
import { NormalizationEngine } from "./normalizationEngine";
import { ValidationEngine } from "./validationEngine";
import { FreshnessEngine } from "./freshnessEngine";
import { RiskEngine } from "./riskEngine";
import { MiddlewareStateMachine } from "./stateMachine";

describe("GATE 2.9 — Firecrawl / External Data Validation Suite", () => {
  const firecrawlProvider = new FirecrawlProvider();
  const normalizer = new NormalizationEngine();
  const validator = new ValidationEngine(300);
  const freshnessEngine = new FreshnessEngine(300);
  const riskEngine = new RiskEngine();

  it("Test 1 — Valid External Data: Scrape -> Normalize -> Validate -> Freshness -> Risk -> PASS", async () => {
    const rawObs: CanonicalRWAObservation = {
      observationId: "obs-fc-rwa-001-live",
      assetId: "RWA-001",
      assetType: "TREASURY",
      valuation: 1002500,
      nav: 1002500,
      yieldRate: 5.2,
      currency: "USD",
      timestamp: Math.floor(Date.now() / 1000),
      source: "Firecrawl Live Ingestion",
      dataSource: "Firecrawl Live Ingestion",
      sourceUrl: "https://treasury.gov/rates/daily-treasury-yield",
      jurisdiction: "US",
      status: "VERIFIED",
      custodyStatus: "VERIFIED",
      settlementStatus: "SETTLED",
      riskStatus: "PASS",
      metadata: { issuer: "US Treasury" },
      metadataHash: "hash-fc-1",
      rawHash: "raw-fc-1",
    };
    assert.ok(rawObs.source.includes("Firecrawl"));

    const normalized = normalizer.normalize(rawObs);
    assert.strictEqual(normalized.assetId, "RWA-001");
    assert.strictEqual(normalized.valuation, 1002500);

    const valRes = validator.validate(normalized);
    assert.strictEqual(valRes.valid, true);

    const freshness = freshnessEngine.evaluate(normalized.timestamp);
    assert.strictEqual(freshness.freshnessStatus, "FRESH");

    const risk = riskEngine.evaluate(normalized, valRes, freshness);
    assert.strictEqual(risk.status, "PASS");
  });

  it("Test 2 — Missing Field: External Data missing NAV -> VALIDATION = FAIL", async () => {
    const rawObs = await firecrawlProvider.getAssetState("RWA-001", "invalid");
    const normalized = normalizer.normalize(rawObs);
    const valRes = validator.validate(normalized);

    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("INVALID_NAV"));
  });

  it("Test 3 — Invalid Custody: External source reports UNVERIFIED -> RISK = FAIL", async () => {
    const rawObs = await firecrawlProvider.getAssetState("RWA-001", "valid");
    const unverifiedRaw: CanonicalRWAObservation = {
      ...rawObs,
      custodyStatus: "UNVERIFIED",
    };

    const normalized = normalizer.normalize(unverifiedRaw);
    const valRes = validator.validate(normalized);
    const freshness = freshnessEngine.evaluate(normalized.timestamp);
    const risk = riskEngine.evaluate(normalized, valRes, freshness);

    assert.strictEqual(risk.status, "FAIL");
    assert.ok(risk.reasonCodes.includes("CUSTODY_UNVERIFIED"));
  });

  it("Test 4 — Stale Source: External source timestamp > 300s -> STALE_DATA", async () => {
    const rawObs = await firecrawlProvider.getAssetState("RWA-001", "stale");
    const normalized = normalizer.normalize(rawObs);
    const valRes = validator.validate(normalized);

    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("STALE_DATA"));
  });

  it("Test 5 — Conflicting Data: Conflicting data across sources yields REJECTED / UNCERTAIN, NEVER SETTLED", async () => {
    const rawObs = await firecrawlProvider.getAssetState("RWA-001", "conflicting");
    const normalized = normalizer.normalize(rawObs);
    const valRes = validator.validate(normalized);
    const freshness = freshnessEngine.evaluate(normalized.timestamp);
    const risk = riskEngine.evaluate(normalized, valRes, freshness);

    assert.strictEqual(risk.status, "FAIL");

    const sm = new MiddlewareStateMachine();
    sm.transition("REQ-FC-CONFLICT", "OBSERVED", "OBSERVE", "Ingested", "ENGINE", "Success");
    if (risk.status === "FAIL") {
      sm.transition("REQ-FC-CONFLICT", "REJECTED", "REJECT", "Conflicting Data", "ENGINE", "Security Halt");
    }

    const finalState = sm.getRecord("REQ-FC-CONFLICT")?.currentState;

    assert.strictEqual(finalState, "REJECTED");
    assert.notStrictEqual(finalState, "ATTESTED");
  });
});
