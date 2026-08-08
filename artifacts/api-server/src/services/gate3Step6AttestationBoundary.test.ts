import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NormalizationEngine } from "./normalizationEngine";
import { ValidationEngine } from "./validationEngine";
import { FreshnessEngine } from "./freshnessEngine";
import { RiskEngine } from "./riskEngine";
import { AttestationService, SignedAttestation } from "./attestationService";
import { CanonicalRWAObservation } from "./rwaProvider";

describe("Gate 3.6 — Validation -> Attestation Boundary Suite", () => {
  const normalizer = new NormalizationEngine();
  const validator = new ValidationEngine(300);
  const freshnessEngine = new FreshnessEngine(300);
  const riskEngine = new RiskEngine();
  const attestationService = new AttestationService();

  const validRawInput: CanonicalRWAObservation = {
    observationId: "obs-gate-3-6-valid",
    assetId: "RWA-001",
    assetType: "TREASURY",
    valuation: 1000000,
    nav: 1000000,
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
    metadata: { issuer: "US Treasury", sourceUrl: "https://treasury.gov/rates/daily-treasury-yield" },
    metadataHash: "sha256-meta-36",
    rawHash: "sha256-raw-36",
  };

  async function processPipeline(raw: CanonicalRWAObservation, requestId = "REQ-G36"): Promise<SignedAttestation | null> {
    const normalized = normalizer.normalize(raw);
    const valRes = validator.validate(normalized);
    const freshness = freshnessEngine.evaluate(normalized.timestamp);
    const risk = riskEngine.evaluate(normalized, valRes, freshness);

    if (!valRes.valid || !freshness.isAttestable || risk.status !== "PASS") {
      return null;
    }

    return await attestationService.generateAttestation(
      normalized.assetId,
      requestId,
      "SETTLED",
      normalized.nav,
      normalized.yieldRate,
      true
    );
  }

  it("Test 1 — Valid Data: Validation PASS + Freshness PASS + Risk PASS -> Attestation CREATED", async () => {
    const attestation = await processPipeline(validRawInput, "REQ-001");

    assert.ok(attestation !== null);
    assert.ok(attestation.signature.startsWith("0x"));
    assert.strictEqual(attestation.payload.assetId, "RWA-001");
    assert.strictEqual(attestation.payload.requestId, "REQ-001");
  });

  it("Test 2 — Invalid Data: Validation FAILED -> Attestation NOT CREATED", async () => {
    const invalidRaw = { ...validRawInput, valuation: 0, nav: 0 };
    const attestation = await processPipeline(invalidRaw, "REQ-002");

    assert.strictEqual(attestation, null);
  });

  it("Test 3 — Stale Data: Freshness FAILED -> Attestation NOT CREATED", async () => {
    const staleTime = Math.floor(Date.now() / 1000) - 500; // > 300s
    const staleRaw = { ...validRawInput, timestamp: staleTime };
    const attestation = await processPipeline(staleRaw, "REQ-003");

    assert.strictEqual(attestation, null);
  });

  it("Test 4 — Risk Failure: Risk Check FAILED -> Attestation NOT CREATED", async () => {
    const unverifiedRaw = { ...validRawInput, custodyStatus: "UNVERIFIED" as any };
    const attestation = await processPipeline(unverifiedRaw, "REQ-004");

    assert.strictEqual(attestation, null);
  });

  it("Test 5 — Required Attestation Metadata & Traceability Verification", async () => {
    const normalized = normalizer.normalize(validRawInput);
    const attestation = await processPipeline(validRawInput, "REQ-TRACE");

    assert.ok(attestation !== null);
    assert.strictEqual(attestation.payload.assetId, "RWA-001");
    assert.strictEqual(normalized.source, "Firecrawl Live Ingestion");
    assert.strictEqual(normalized.sourceUrl, "https://treasury.gov/rates/daily-treasury-yield");
    assert.ok(normalized.timestamp > 0);
    assert.ok(normalized.rawHash.length > 0);
    assert.ok(normalized.metadataHash.length > 0);
  });

  it("Critical Authority Audit — Firecrawl Provider Code Contains Zero Signing Authority", () => {
    const providerPath = path.resolve(process.cwd(), "src/services/rwaProvider.ts");
    const code = fs.readFileSync(providerPath, "utf-8");

    assert.strictEqual(
      code.includes("generateAttestation"),
      false,
      "FirecrawlProvider must NOT contain generateAttestation method!"
    );
    assert.strictEqual(
      code.includes("privateKeyToAccount"),
      false,
      "FirecrawlProvider must NOT import privateKeyToAccount!"
    );
  });
});
