import assert from "node:assert";
import { describe, it } from "node:test";
import { FreshnessEngine } from "./freshnessEngine";
import { NormalizationEngine } from "./normalizationEngine";
import { RiskEngine } from "./riskEngine";
import { MockRWAProvider } from "./rwaProvider";
import { ValidationEngine } from "./validationEngine";

describe("GATE 3 — RWA Middleware Validation Suite (9 Pipeline Test Vectors)", () => {
  const normalizer = new NormalizationEngine();
  const validator = new ValidationEngine(300);
  const freshnessEngine = new FreshnessEngine(300);
  const riskEngine = new RiskEngine();
  const mockProvider = new MockRWAProvider();

  it("1. Valid data (NAV=1,000,000 USD, Yield=5.2%, Custody=VERIFIED, Settlement=PENDING) -> Attestation Issued", async () => {
    const rawObs = await mockProvider.getAssetState("RWA-001", "valid");
    const normalized = normalizer.normalize(rawObs);

    assert.strictEqual(normalized.assetId, "RWA-001");
    assert.strictEqual(normalized.valuation, 1002500);

    const valRes = validator.validate(normalized);
    assert.strictEqual(valRes.valid, true);

    const freshness = freshnessEngine.evaluate(normalized.timestamp);
    assert.strictEqual(freshness.freshnessStatus, "FRESH");

    const risk = riskEngine.evaluate(normalized, valRes, freshness);
    assert.strictEqual(risk.status, "PASS");
    assert.strictEqual(risk.riskLevel, "LOW");
  });

  it("2. Missing fields -> Schema Validation Fail", async () => {
    const rawObs = await mockProvider.getAssetState("RWA-001", "valid");
    const incompletePayload = { ...rawObs, assetId: "" };
    const normalized = normalizer.normalize(incompletePayload);

    const valRes = validator.validate(normalized);
    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("INVALID_ASSET_ID"));
  });

  it("3. Invalid NAV (NAV = -1) -> NAV Validation Fail", async () => {
    const rawObs = await mockProvider.getAssetState("RWA-001", "invalid"); // NAV = -1
    const normalized = normalizer.normalize(rawObs);

    const valRes = validator.validate(normalized);
    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("INVALID_NAV"));
  });

  it("4. Invalid asset ID -> Asset Validation Fail", async () => {
    const rawObs = await mockProvider.getAssetState("RWA-001", "valid");
    const malformedAsset = { ...rawObs, asset_id: undefined };
    const normalized = normalizer.normalize(malformedAsset);

    const valRes = validator.validate(normalized);
    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("INVALID_ASSET_ID"));
  });

  it("5. Invalid custody (UNVERIFIED) -> Risk Engine Fail", async () => {
    const rawObs = await mockProvider.getAssetState("RWA-001", "conflicting");
    const normalized = normalizer.normalize(rawObs);

    const valRes = validator.validate(normalized);
    const risk = riskEngine.evaluate(normalized, valRes);

    assert.strictEqual(risk.status, "FAIL");
    assert.ok(risk.reasonCodes.includes("CUSTODY_UNVERIFIED"));
  });

  it("6. Invalid settlement status (FAILED) -> Settlement Status Validation Fail", async () => {
    const rawObs = await mockProvider.getAssetState("RWA-001", "valid");
    const failedSettlement = { ...rawObs, raw_payload: { status: "SETTLEMENT_FAILED" } };
    const normalized = normalizer.normalize(failedSettlement);

    const valRes = validator.validate(normalized);
    const risk = riskEngine.evaluate(normalized, valRes);

    assert.strictEqual(risk.status, "FAIL");
  });

  it("7. Malformed payload -> Schema Validation Fail", async () => {
    const malformed = { raw_payload: "NOT_JSON_OR_CORRUPT" };
    const normalized = normalizer.normalize(malformed);

    const valRes = validator.validate(normalized);
    assert.strictEqual(valRes.valid, false);
  });

  it("8. Unknown asset -> Provider Lookup Fail", async () => {
    await assert.rejects(
      async () => await mockProvider.getAssetState("UNKNOWN-ASSET-999"),
      /UNKNOWN_ASSET/
    );
  });

  it("9. Unexpected source (untrusted domain) -> Source Allowlisting Fail", async () => {
    const rawObs = await mockProvider.getAssetState("RWA-001", "valid");
    const untrustedSource = { ...rawObs, source: "untrusted-scammer-domain.xyz" };
    const normalized = normalizer.normalize(untrustedSource);

    const valRes = validator.validate(normalized);
    const risk = riskEngine.evaluate(normalized, valRes);

    assert.strictEqual(risk.status, "FAIL");
    assert.ok(risk.reasonCodes.includes("UNTRUSTED_SOURCE_PROVIDER"));
  });
});
