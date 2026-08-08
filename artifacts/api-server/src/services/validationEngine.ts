import { RWAAssetState } from "./rwaProvider";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export class ValidationEngine {
  private maxDataAgeSeconds: number;

  constructor(maxDataAgeSeconds = 900) { // 15 minutes default
    this.maxDataAgeSeconds = maxDataAgeSeconds;
  }

  validate(state: RWAAssetState): ValidationResult {
    const errors: string[] = [];

    if (!state.assetId || state.assetId.trim() === "") {
      errors.push("INVALID_ASSET_ID");
    }

    const now = Math.floor(Date.now() / 1000);
    if (now - state.timestamp > this.maxDataAgeSeconds) {
      errors.push("STALE_DATA");
    }

    if (state.nav <= 0) {
      errors.push("INVALID_NAV");
    }

    if (state.custodyStatus !== "VERIFIED") {
      errors.push("CUSTODY_NOT_VERIFIED");
    }

    if (state.settlementStatus !== "SETTLED") {
      errors.push("SETTLEMENT_NOT_CONFIRMED");
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
