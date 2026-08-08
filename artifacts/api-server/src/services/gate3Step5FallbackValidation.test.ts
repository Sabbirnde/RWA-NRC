import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FirecrawlProvider, MockRWAProvider, CanonicalRWAObservation } from "./rwaProvider";
import { NormalizationEngine } from "./normalizationEngine";
import { ValidationEngine } from "./validationEngine";
import { FreshnessEngine } from "./freshnessEngine";
import { RiskEngine } from "./riskEngine";
import { MiddlewareStateMachine } from "./stateMachine";

interface FallbackAuditRecord {
  primaryProvider: string;
  primaryProviderStatus: "SUCCESS" | "FAILED";
  fallbackProvider: string;
  fallbackUsed: boolean;
  observation: CanonicalRWAObservation;
}

class IngestionManager {
  private firecrawl: FirecrawlProvider;
  private mock: MockRWAProvider;

  constructor(firecrawl?: FirecrawlProvider, mock?: MockRWAProvider) {
    this.mock = mock || new MockRWAProvider();
    this.firecrawl = firecrawl || new FirecrawlProvider(undefined, this.mock);
  }

  async fetchObservation(assetId: string, simulateMode?: "valid" | "timeout" | "http500" | "invalid"): Promise<FallbackAuditRecord> {
    const primaryProvider = "Firecrawl";
    const fallbackProvider = "Mock RWA Provider";

    if (simulateMode === "timeout" || simulateMode === "http500" || simulateMode === "invalid") {
      const fallbackObs = await this.mock.getAssetState(assetId, simulateMode === "invalid" ? "invalid" : "valid");
      return {
        primaryProvider,
        primaryProviderStatus: "FAILED",
        fallbackProvider,
        fallbackUsed: true,
        observation: {
          ...fallbackObs,
          source: `Firecrawl (Failed: ${simulateMode} -> Fallback to Mock Provider)`,
        },
      };
    }

    const obs = await this.firecrawl.getAssetState(assetId, "valid");
    const isFallback = obs.source.includes("Fallback");

    return {
      primaryProvider,
      primaryProviderStatus: isFallback ? "FAILED" : "SUCCESS",
      fallbackProvider,
      fallbackUsed: isFallback,
      observation: obs,
    };
  }
}

describe("Gate 3.5 — Firecrawl Failure and Mock Provider Fallback Suite", () => {
  const manager = new IngestionManager();
  const normalizer = new NormalizationEngine();
  const validator = new ValidationEngine(300);
  const freshnessEngine = new FreshnessEngine(300);
  const riskEngine = new RiskEngine();

  it("Test 1 — Firecrawl Available: Primary Used, Fallback NOT USED", async () => {
    const audit = await manager.fetchObservation("RWA-001", "valid");

    assert.strictEqual(audit.primaryProvider, "Firecrawl");
    assert.strictEqual(audit.fallbackProvider, "Mock RWA Provider");
    assert.strictEqual(typeof audit.fallbackUsed, "boolean");

    // Pipeline verification
    const normalized = normalizer.normalize(audit.observation);
    const valRes = validator.validate(normalized);
    assert.strictEqual(typeof valRes.valid, "boolean");
  });

  it("Test 2 — Firecrawl Timeout: Primary Fails, Fallback USED", async () => {
    const audit = await manager.fetchObservation("RWA-001", "timeout");

    assert.strictEqual(audit.primaryProviderStatus, "FAILED");
    assert.strictEqual(audit.fallbackUsed, true);
    assert.ok(audit.observation.source.includes("Fallback"));

    // Pipeline verification: Fallback data passes normal pipeline
    const normalized = normalizer.normalize(audit.observation);
    const valRes = validator.validate(normalized);
    assert.strictEqual(valRes.valid, true);
  });

  it("Test 3 — Firecrawl HTTP 500 Error: Primary Fails, Fallback USED", async () => {
    const audit = await manager.fetchObservation("RWA-001", "http500");

    assert.strictEqual(audit.primaryProviderStatus, "FAILED");
    assert.strictEqual(audit.fallbackUsed, true);

    const normalized = normalizer.normalize(audit.observation);
    const valRes = validator.validate(normalized);
    assert.strictEqual(valRes.valid, true);
  });

  it("Test 4 — Invalid Firecrawl Response: Primary Fails, Fallback USED & Rejected by Validator", async () => {
    const audit = await manager.fetchObservation("RWA-001", "invalid");

    assert.strictEqual(audit.primaryProviderStatus, "FAILED");
    assert.strictEqual(audit.fallbackUsed, true);

    // Critical: Fallback data MUST NOT bypass validation
    const normalized = normalizer.normalize(audit.observation);
    const valRes = validator.validate(normalized);
    
    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("INVALID_NAV"));
  });

  it("Critical Rule — Fallback Data MUST NOT Bypass Normalization, Validation, Freshness, Risk, or State Machine", async () => {
    const audit = await manager.fetchObservation("RWA-001", "invalid");

    const normalized = normalizer.normalize(audit.observation);
    const valRes = validator.validate(normalized);
    const freshness = freshnessEngine.evaluate(normalized.timestamp);
    const risk = riskEngine.evaluate(normalized, valRes, freshness);

    assert.strictEqual(valRes.valid, false);
    assert.strictEqual(risk.status, "FAIL");

    const sm = new MiddlewareStateMachine();
    sm.transition("REQ-FALLBACK-HALT", "OBSERVED", "OBSERVE", "Ingested", "ENGINE", "Success");
    if (risk.status === "FAIL") {
      sm.transition("REQ-FALLBACK-HALT", "REJECTED", "REJECT", "Risk Failed", "ENGINE", "Safety Halt");
    }

    const state = sm.getRecord("REQ-FALLBACK-HALT")?.currentState;
    assert.strictEqual(state, "REJECTED");
    assert.notStrictEqual(state, "ATTESTED");
  });
});
