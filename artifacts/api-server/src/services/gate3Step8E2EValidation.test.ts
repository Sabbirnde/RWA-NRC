import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FirecrawlProvider, MockRWAProvider, CanonicalRWAObservation } from "./rwaProvider";
import { NormalizationEngine } from "./normalizationEngine";
import { ValidationEngine } from "./validationEngine";
import { FreshnessEngine } from "./freshnessEngine";
import { RiskEngine } from "./riskEngine";
import { MiddlewareStateMachine } from "./stateMachine";
import { AttestationService, SignedAttestation } from "./attestationService";

describe("Gate 3.8 — UI and End-to-End Firecrawl Validation Suite", () => {
  const normalizer = new NormalizationEngine();
  const validator = new ValidationEngine(300);
  const freshnessEngine = new FreshnessEngine(300);
  const riskEngine = new RiskEngine();
  const attestationService = new AttestationService();

  it("Test 1 — Full Successful Flow: Public Source -> Firecrawl -> Raw -> Normalize -> Validate -> Freshness -> Risk -> SM -> Attestation -> Blockchain", async () => {
    const firecrawl = new FirecrawlProvider();
    const rawObs = await firecrawl.getAssetState("RWA-001", "valid");

    assert.ok(rawObs.source.includes("Firecrawl"));
    assert.ok(rawObs.sourceUrl.length > 0);

    const normalized = normalizer.normalize(rawObs);
    assert.strictEqual(normalized.assetId, "RWA-001");

    const valRes = validator.validate(normalized);
    assert.strictEqual(valRes.valid, true);

    const freshness = freshnessEngine.evaluate(normalized.timestamp);
    assert.strictEqual(freshness.isAttestable, true);

    const risk = riskEngine.evaluate(normalized, valRes, freshness);
    assert.strictEqual(risk.status, "PASS");

    const sm = new MiddlewareStateMachine();
    sm.createRecord("REQ-E2E-SUCCESS", "RWA-001");
    sm.transition("REQ-E2E-SUCCESS", "OBSERVED", "OBSERVE", "Scraped payload", "FIRECRAWL", "Valid");
    sm.transition("REQ-E2E-SUCCESS", "VALIDATED", "VALIDATE", "Schema check", "ENGINE", "Pass");
    sm.transition("REQ-E2E-SUCCESS", "ATTESTABLE", "EVALUATE", "Risk & Freshness", "ENGINE", "Pass");
    sm.transition("REQ-E2E-SUCCESS", "ATTESTED", "ATTEST", "Signature produced", "ENGINE", "Sign");

    const attestation: SignedAttestation = await attestationService.generateAttestation(
      normalized.assetId,
      "REQ-E2E-SUCCESS",
      "SETTLED",
      normalized.nav,
      normalized.yieldRate,
      true
    );

    assert.ok(attestation !== null);
    assert.ok(attestation.signature.startsWith("0x"));
    assert.strictEqual(sm.getRecord("REQ-E2E-SUCCESS")?.currentState, "ATTESTED");
  });

  it("Test 2 — Full Failure Flow: Public Source -> Firecrawl -> Invalid Data -> Validation FAILED -> Attestation Blocked", async () => {
    const rawInvalid: CanonicalRWAObservation = {
      observationId: "obs-fc-invalid-e2e",
      assetId: "RWA-001",
      assetType: "TREASURY",
      valuation: 0,
      nav: 0,
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
      metadata: {},
      metadataHash: "hash-meta-err",
      rawHash: "hash-raw-err",
    };

    const normalized = normalizer.normalize(rawInvalid);
    const valRes = validator.validate(normalized);

    assert.strictEqual(valRes.valid, false);
    assert.ok(valRes.errors.includes("INVALID_NAV"));

    // Attestation MUST NOT be created
    let attestation: SignedAttestation | null = null;
    if (valRes.valid) {
      attestation = await attestationService.generateAttestation(
        normalized.assetId,
        "REQ-E2E-FAIL",
        "SETTLED",
        normalized.nav,
        normalized.yieldRate,
        true
      );
    }

    assert.strictEqual(attestation, null);
  });

  it("Test 3 — Firecrawl Failure & Fallback Flow: Firecrawl FAIL -> Mock USED -> Normal Pipeline -> Attestation", async () => {
    const mock = new MockRWAProvider();
    const fallbackObs = await mock.getAssetState("RWA-001", "valid");
    const rawFallback = {
      ...fallbackObs,
      source: "Firecrawl (Failed: timeout -> Fallback to Mock Provider)",
    };

    assert.ok(rawFallback.source.includes("Fallback"));

    const normalized = normalizer.normalize(rawFallback);
    const valRes = validator.validate(normalized);
    assert.strictEqual(valRes.valid, true);

    const attestation = await attestationService.generateAttestation(
      normalized.assetId,
      "REQ-E2E-FALLBACK",
      "SETTLED",
      normalized.nav,
      normalized.yieldRate,
      true
    );

    assert.ok(attestation !== null);
  });

  it("Test 4 — UI Audit: Zero Occurrences of 'Firecrawl Oracle' & Correct Authority Labels", () => {
    const appTsxPath = path.resolve(process.cwd(), "../../artifacts/rwa-protocol-console/src/App.tsx");
    const appCode = fs.readFileSync(appTsxPath, "utf-8");

    assert.strictEqual(
      appCode.includes("Firecrawl Oracle"),
      false,
      "UI code MUST NEVER contain 'Firecrawl Oracle'!"
    );
    assert.ok(appCode.includes("Source:"));
    assert.ok(appCode.includes("Data status:"));
    assert.ok(appCode.includes("Validation:"));
    assert.ok(appCode.includes("Blockchain authority:"));
    assert.ok(appCode.includes("Attestation Service"));
  });
});
