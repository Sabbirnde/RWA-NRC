import { RWAAssetState } from "./rwaProvider";

export interface ValidationContext {
  currentState?: string;
  expectedIssuer?: string;
  nonce?: bigint;
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

  validate(state: RWAAssetState, context?: ValidationContext): ValidationResult {
    const errors: string[] = [];
    const val = typeof state.valuation === "number" ? state.valuation : state.nav;

    // 1. Schema check
    if (!state || typeof state !== "object" || typeof val !== "number" || typeof state.timestamp !== "number") {
      errors.push("INVALID_SCHEMA");
      return { valid: false, errors };
    }

    // 2. Asset ID check
    if (!state.assetId || typeof state.assetId !== "string" || state.assetId.trim() === "") {
      errors.push("INVALID_ASSET_ID");
    }

    // 3. Timestamp check
    const now = Math.floor(Date.now() / 1000);
    if (!state.timestamp || state.timestamp <= 0 || state.timestamp > now + 300) {
      errors.push("INVALID_TIMESTAMP");
    }

    // 4. Freshness check
    if (now - state.timestamp > this.maxDataAgeSeconds) {
      errors.push("STALE_DATA");
    }

    // 5. State transition check
    if (context?.currentState === "FINALIZED" || context?.currentState === "REJECTED") {
      errors.push("INVALID_STATE_TRANSITION");
    }

    // 6. NAV / Valuation sanity check
    if (typeof val !== "number" || val <= 0 || Number.isNaN(val)) {
      errors.push("INVALID_NAV");
    }

    // 7. Issuer check
    if (context?.expectedIssuer && state.assetType !== context.expectedIssuer && state.dataSource === "UNKNOWN") {
      errors.push("INVALID_ISSUER");
    }

    // 8. Custody status check
    if (state.custodyStatus !== "VERIFIED") {
      errors.push("CUSTODY_NOT_VERIFIED");
    }

    // 9. Settlement status check
    if (state.settlementStatus !== "SETTLED") {
      errors.push("SETTLEMENT_NOT_CONFIRMED");
    }

    // 10. Nonce check
    if (context?.nonce !== undefined && context.nonce <= 0n) {
      errors.push("INVALID_NONCE");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
