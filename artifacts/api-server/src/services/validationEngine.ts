import { NormalizedRWAObservation } from "./normalizationEngine";
import { RWAAssetState } from "./rwaProvider";

export interface ValidationContext {
  currentState?: string;
  expectedIssuer?: string;
  nonce?: bigint;
  seenObservationIds?: Set<string>;
  seenMetadataHashes?: Set<string>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export class ValidationEngine {
  private maxDataAgeSeconds: number;

  constructor(maxDataAgeSeconds?: number) {
    const envAge = process.env.MAX_DATA_AGE_SECONDS ? parseInt(process.env.MAX_DATA_AGE_SECONDS, 10) : undefined;
    this.maxDataAgeSeconds = maxDataAgeSeconds ?? envAge ?? 300; // 5 minutes default (300s)
  }

  validate(state: RWAAssetState | NormalizedRWAObservation, context?: ValidationContext): ValidationResult {
    const errors: string[] = [];
    const val = typeof state.valuation === "number" ? state.valuation : state.nav;

    // 1. Schema check & Required fields
    if (!state || typeof state !== "object") {
      errors.push("INVALID_SCHEMA");
      return { valid: false, errors };
    }
    if (!state.observationId || typeof state.observationId !== "string" || state.observationId.trim() === "") {
      errors.push("MISSING_OBSERVATION_ID");
    }
    if (!state.assetId || typeof state.assetId !== "string" || state.assetId.trim() === "") {
      errors.push("INVALID_ASSET_ID");
    }

    // 2. Timestamp check
    const now = Math.floor(Date.now() / 1000);
    if (!state.timestamp || state.timestamp <= 0 || state.timestamp > now + 300) {
      errors.push("INVALID_TIMESTAMP");
    }

    // 3. Freshness check
    if (now - state.timestamp > this.maxDataAgeSeconds) {
      errors.push("STALE_DATA");
    }

    // 4. Duplicate detection
    if (context?.seenObservationIds && context.seenObservationIds.has(state.observationId)) {
      errors.push("DUPLICATE_OBSERVATION_ID");
    }
    if (state.metadataHash && context?.seenMetadataHashes && context.seenMetadataHashes.has(state.metadataHash)) {
      errors.push("DUPLICATE_METADATA_HASH");
    }

    // 5. State transition check
    if (context?.currentState === "FINALIZED" || context?.currentState === "REJECTED") {
      errors.push("INVALID_STATE_TRANSITION");
    }

    // 6. Valuation range & sanity check
    if (typeof val !== "number" || val <= 0 || Number.isNaN(val) || val > 1_000_000_000_000) {
      errors.push("INVALID_NAV");
    }

    // 7. Source & URL validation
    const sourceStr = state.source || state.dataSource || "";
    if (!sourceStr || sourceStr.trim() === "" || sourceStr.includes("Disallowed")) {
      errors.push("UNAUTHORIZED_SOURCE");
    }
    if (!state.sourceUrl || typeof state.sourceUrl !== "string" || state.sourceUrl.trim() === "") {
      errors.push("MISSING_SOURCE_URL");
    }

    // 7b. Yield rate sanity check
    if (typeof state.yieldRate !== "number" || Number.isNaN(state.yieldRate) || state.yieldRate < 0 || state.yieldRate > 100) {
      errors.push("INVALID_YIELD");
    }

    // 8. Consistency validation (Custody & Settlement)
    if (state.custodyStatus !== "VERIFIED") {
      errors.push("CUSTODY_NOT_VERIFIED");
    }
    if (state.settlementStatus !== "SETTLED") {
      errors.push("SETTLEMENT_NOT_CONFIRMED");
    }

    // 9. Issuer / Asset identity validation
    if (context?.expectedIssuer && state.assetType !== context.expectedIssuer && sourceStr === "UNKNOWN") {
      errors.push("INVALID_ISSUER");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
