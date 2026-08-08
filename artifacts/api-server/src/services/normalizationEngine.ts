import { createHash } from "node:crypto";
import { CanonicalRWAObservation } from "./rwaProvider";

export interface NormalizedRWAObservation {
  observationId: string;
  assetId: string; // Trimmed uppercase (e.g. "RWA-001")
  assetType: string; // Uppercase (e.g. "TREASURY")
  valuation: number; // USD numeric value (2 decimal places)
  valuation6Decimals: bigint; // Integer with 6 decimals (e.g. 1002500000000n)
  nav: number; // Alias for valuation
  yieldRate: number; // Annualized yield percentage (e.g. 5.2)
  currency: string; // Uppercase ISO code (e.g. "USD")
  decimals: number; // Standard: 6
  timestamp: number; // Integer seconds
  source: string; // Standardized string
  dataSource: string; // Alias for source
  sourceUrl: string; // Normalized URL
  jurisdiction: string; // Uppercase country/region code ("US")
  status: "VERIFIED" | "PENDING" | "REJECTED" | "UNVERIFIED";
  custodyStatus: "VERIFIED" | "UNVERIFIED" | "PENDING";
  settlementStatus: "SETTLED" | "PENDING" | "REJECTED";
  riskStatus: "PASS" | "FAIL" | "LOW" | "ELEVATED";
  metadata: Record<string, unknown>; // Key-sorted metadata object
  metadataHash: string; // Deterministic SHA-256 hash of key-sorted metadata JSON
  rawHash: string; // SHA-256 hash of raw input
}

export class NormalizationEngine {
  private hashObject(obj: unknown): string {
    if (!obj || typeof obj !== "object") return createHash("sha256").update(String(obj)).digest("hex");
    const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
    const str = JSON.stringify(obj, sortedKeys);
    return createHash("sha256").update(str).digest("hex");
  }

  normalize(input: CanonicalRWAObservation): NormalizedRWAObservation {
    if (!input || typeof input !== "object") {
      throw new Error("Cannot normalize null or invalid input observation");
    }

    const assetId = (input.assetId || "").trim().toUpperCase();
    const assetType = (input.assetType || "TREASURY").trim().toUpperCase();
    const currency = (input.currency || "USD").trim().toUpperCase();
    const jurisdiction = (input.jurisdiction || "US").trim().toUpperCase();
    const numVal = typeof input.valuation === "number" ? input.valuation : typeof input.nav === "number" ? input.nav : Number(input.valuation || input.nav);
    const valuation = typeof numVal === "number" && !Number.isNaN(numVal) && numVal > 0 ? Math.round(numVal * 100) / 100 : 0;
    const valuation6Decimals = BigInt(Math.round(valuation * 1_000_000));
    const timestamp = typeof input.timestamp === "number" ? Math.floor(input.timestamp) : 0;
    const source = (input.source || input.dataSource || "UNKNOWN").trim();
    const sourceUrl = (input.sourceUrl || "").trim().toLowerCase();

    // Canonicalize metadata keys deterministically
    const rawMetadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
    const sortedMetadataKeys = Object.keys(rawMetadata).sort();
    const metadata: Record<string, unknown> = {};
    for (const key of sortedMetadataKeys) {
      metadata[key] = (rawMetadata as Record<string, unknown>)[key];
    }
    const metadataHash = this.hashObject(metadata);
    const rawHash = input.rawHash || this.hashObject(input);

    return {
      observationId: input.observationId || `obs-${assetId}-${timestamp}`,
      assetId,
      assetType,
      valuation,
      valuation6Decimals,
      nav: valuation,
      yieldRate: input.yieldRate || 5.2,
      currency,
      decimals: 6,
      timestamp,
      source,
      dataSource: source,
      sourceUrl,
      jurisdiction,
      status: input.status || "UNVERIFIED",
      custodyStatus: input.custodyStatus || "PENDING",
      settlementStatus: input.settlementStatus || "PENDING",
      riskStatus: input.riskStatus || "FAIL",
      metadata,
      metadataHash,
      rawHash,
    };
  }
}
