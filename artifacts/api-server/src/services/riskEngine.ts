import { FreshnessEvaluation } from "./freshnessEngine";
import { NormalizedRWAObservation } from "./normalizationEngine";
import { ValidationResult } from "./validationEngine";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RiskEvaluationResult {
  riskScore: number; // 0 to 100
  confidence: number; // 0.00 to 1.00
  riskLevel: RiskLevel;
  reasonCodes: string[];
  status: "PASS" | "FAIL";
  reasons: string[]; // Backwards compatibility alias
}

export class RiskEngine {
  evaluate(
    observation: NormalizedRWAObservation,
    validationResult: ValidationResult,
    freshness?: FreshnessEvaluation,
    previousValuation?: number
  ): RiskEvaluationResult {
    let riskScore = 0;
    let confidence = 1.0;
    const reasonCodes: string[] = [];

    // 1. Validation Failures
    if (!validationResult.valid) {
      riskScore += 50;
      confidence -= 0.3;
      reasonCodes.push(...validationResult.errors);
    }

    // 2. Source Reliability
    const allowedSources = ["Firecrawl Live Ingestion", "Mock RWA Provider", "Treasury.gov API"];
    if (!allowedSources.some((s) => observation.source.includes(s))) {
      riskScore += 40;
      confidence -= 0.2;
      reasonCodes.push("UNTRUSTED_SOURCE_PROVIDER");
    }

    // 3. Data Freshness Assessment
    if (freshness) {
      switch (freshness.freshnessStatus) {
        case "FRESH":
          break;
        case "AGING":
          riskScore += 10;
          confidence -= 0.05;
          reasonCodes.push("AGING_DATA_WARNING");
          break;
        case "STALE":
          riskScore += 50;
          confidence -= 0.3;
          reasonCodes.push("STALE_DATA_REJECT");
          break;
        case "EXPIRED":
          riskScore += 100;
          confidence -= 0.5;
          reasonCodes.push("EXPIRED_DATA_CRITICAL");
          break;
      }
    }

    // 4. Valuation Shift & Confidence
    if (observation.valuation <= 0) {
      riskScore += 100;
      confidence = 0.0;
      reasonCodes.push("ZERO_OR_NEGATIVE_VALUATION");
    } else if (previousValuation && previousValuation > 0) {
      const deltaPercent = Math.abs(observation.valuation - previousValuation) / previousValuation;
      if (deltaPercent > 0.1) {
        // > 10% jump
        riskScore += 30;
        confidence -= 0.15;
        reasonCodes.push("HIGH_VALUATION_VOLATILITY");
      }
    }

    // 5. Custody & Counterparty & Jurisdiction Risk
    if (observation.custodyStatus !== "VERIFIED") {
      riskScore += 40;
      confidence -= 0.2;
      reasonCodes.push("CUSTODY_UNVERIFIED");
    }
    if (observation.settlementStatus !== "SETTLED") {
      riskScore += 40;
      confidence -= 0.2;
      reasonCodes.push("SETTLEMENT_UNCONFIRMED");
    }
    if (observation.riskStatus === "ELEVATED" || observation.riskStatus === "FAIL") {
      riskScore += 35;
      confidence -= 0.15;
      reasonCodes.push("HIGH_CREDIT_RISK");
    }
    if (observation.jurisdiction !== "US" && observation.jurisdiction !== "EU") {
      riskScore += 20;
      confidence -= 0.1;
      reasonCodes.push("OFFSHORE_JURISDICTION_RISK");
    }

    // Cap values
    riskScore = Math.min(100, Math.max(0, riskScore));
    confidence = Math.min(1.0, Math.max(0.0, Math.round(confidence * 100) / 100));

    let riskLevel: RiskLevel;
    if (riskScore <= 20) {
      riskLevel = "LOW";
    } else if (riskScore <= 50) {
      riskLevel = "MEDIUM";
    } else if (riskScore <= 80) {
      riskLevel = "HIGH";
    } else {
      riskLevel = "CRITICAL";
    }

    const status: "PASS" | "FAIL" = riskScore < 50 && reasonCodes.length === 0 ? "PASS" : "FAIL";

    return {
      riskScore,
      confidence,
      riskLevel,
      reasonCodes,
      status,
      reasons: reasonCodes,
    };
  }
}
