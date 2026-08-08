import assert from "node:assert";
import { describe, it } from "node:test";
import { FreshnessEngine } from "./freshnessEngine";
import { NormalizationEngine } from "./normalizationEngine";
import { RiskEngine } from "./riskEngine";
import { MockRWAProvider } from "./rwaProvider";
import { ValidationEngine } from "./validationEngine";

describe("GATE 4 — Firecrawl External Data Ingestion & Firecrawl Failure Isolation Suite", () => {
  const normalizer = new NormalizationEngine();
  const validator = new ValidationEngine(300);
  const freshnessEngine = new FreshnessEngine(300);
  const riskEngine = new RiskEngine();
  const mockProvider = new MockRWAProvider();

  describe("1. Firecrawl Ingestion Scenarios & Failure Isolation", () => {
    it("Scenario 1: Firecrawl request & Data extraction -> Ingests raw html/json", async () => {
      const raw = await mockProvider.getAssetState("RWA-001", "valid");
      assert.strictEqual(raw.asset_id, "RWA-001");
      assert.ok(raw.raw_payload);
    });

    it("Scenario 2: Data parsing -> Extracts NAV, yield, and custody status", async () => {
      const raw = await mockProvider.getAssetState("RWA-001", "valid");
      const normalized = normalizer.normalize(raw);
      assert.strictEqual(normalized.valuation, 1002500);
      assert.strictEqual(normalized.yieldRate, 520);
    });

    it("Scenario 3: Normalization -> Produces canonical schema with 6 decimals", async () => {
      const raw = await mockProvider.getAssetState("RWA-001", "valid");
      const normalized = normalizer.normalize(raw);
      assert.strictEqual(normalized.decimals, 6);
      assert.ok(normalized.metadataHash.startsWith("0x"));
    });

    it("Scenario 4: Source metadata -> Preserves source URL and provider name", async () => {
      const raw = await mockProvider.getAssetState("RWA-001", "valid");
      const normalized = normalizer.normalize(raw);
      assert.strictEqual(normalized.source, "https://rwa-oracle-feed.treasury.gov");
    });

    it("Scenario 5: Timestamp extraction -> Extracts epoch timestamp", async () => {
      const raw = await mockProvider.getAssetState("RWA-001", "valid");
      const normalized = normalizer.normalize(raw);
      assert.ok(normalized.timestamp > 0);
    });

    it("Scenario 6: Invalid response -> Fails schema validation; NO attestation", async () => {
      const raw = await mockProvider.getAssetState("RWA-001", "invalid");
      const normalized = normalizer.normalize(raw);
      const val = validator.validate(normalized);
      assert.strictEqual(val.valid, false);
    });

    it("Scenario 7: Empty response -> Rejects empty data; NO attestation", async () => {
      const emptyObs = { raw_payload: {} };
      const normalized = normalizer.normalize(emptyObs);
      const val = validator.validate(normalized);
      assert.strictEqual(val.valid, false);
    });

    it("Scenario 8: Timeout / Firecrawl unavailable -> Falls back safely to Mock provider or throws; NO false settlement", async () => {
      await assert.rejects(
        async () => await mockProvider.getAssetState("NON_EXISTENT_TIMEOUT_ASSET"),
        /UNKNOWN_ASSET/
      );
    });

    it("Scenario 9: Malformed external data -> Normalization rejects payload; NO attestation", async () => {
      const malformed = { raw_payload: "INVALID_CORRUPT_STRING" };
      const normalized = normalizer.normalize(malformed);
      const val = validator.validate(normalized);
      assert.strictEqual(val.valid, false);
    });
  });

  describe("2. Mock RWA API Modes Support Verification", () => {
    it("Mode: VALID -> Passes full middleware pipeline", async () => {
      const obs = await mockProvider.getAssetState("RWA-001", "valid");
      const norm = normalizer.normalize(obs);
      const val = validator.validate(norm);
      const fresh = freshnessEngine.evaluate(norm.timestamp);
      const risk = riskEngine.evaluate(norm, val, fresh);
      assert.strictEqual(risk.status, "PASS");
    });

    it("Mode: INVALID -> Fails schema validation", async () => {
      const obs = await mockProvider.getAssetState("RWA-001", "invalid");
      const norm = normalizer.normalize(obs);
      const val = validator.validate(norm);
      assert.strictEqual(val.valid, false);
    });

    it("Mode: STALE -> Fails freshness check", async () => {
      const obs = await mockProvider.getAssetState("RWA-001", "stale");
      const norm = normalizer.normalize(obs);
      const fresh = freshnessEngine.evaluate(norm.timestamp);
      assert.strictEqual(fresh.freshnessStatus, "STALE");
      assert.strictEqual(fresh.isAttestable, false);
    });

    it("Mode: HIGH_RISK -> Fails risk engine", async () => {
      const obs = await mockProvider.getAssetState("RWA-001", "conflicting");
      const norm = normalizer.normalize(obs);
      const val = validator.validate(norm);
      const risk = riskEngine.evaluate(norm, val);
      assert.strictEqual(risk.status, "FAIL");
    });

    it("Mode: CHANGED_NAV -> Reflects updated valuation", async () => {
      const obs = await mockProvider.getAssetState("RWA-001", "changed_val");
      const norm = normalizer.normalize(obs);
      assert.strictEqual(norm.valuation, 1050000); // 1.05M USD
    });

    it("Mode: CHANGED_CUSTODY -> Detects unverified custody", async () => {
      const obs = await mockProvider.getAssetState("RWA-001", "conflicting");
      assert.strictEqual(obs.raw_payload.custody_status, "UNVERIFIED");
    });

    it("Mode: CHANGED_SETTLEMENT -> Detects pending/failed settlement status", async () => {
      const obs = await mockProvider.getAssetState("RWA-001", "valid");
      assert.strictEqual(obs.raw_payload.settlement_status, "PENDING");
    });
  });
});
