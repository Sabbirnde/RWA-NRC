import { RWAAssetState } from "./rwaProvider";
import { ValidationResult } from "./validationEngine";

export interface RiskResult {
  status: "PASS" | "FAIL";
  reasons: string[];
}

export class RiskEngine {
  evaluate(state: RWAAssetState, validationResult: ValidationResult): RiskResult {
    const reasons: string[] = [...validationResult.errors];

    if (state.riskStatus === "ELEVATED" || state.riskStatus === "FAIL") {
      reasons.push("HIGH_CREDIT_RISK");
    }

    const status = reasons.length === 0 ? "PASS" : "FAIL";

    return {
      status,
      reasons,
    };
  }
}
