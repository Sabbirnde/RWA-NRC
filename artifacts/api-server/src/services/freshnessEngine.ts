export type FreshnessStatus = "FRESH" | "AGING" | "STALE" | "EXPIRED";

export interface FreshnessEvaluation {
  observedAt: number; // Observation timestamp (epoch seconds)
  receivedAt: number; // Middleware reception timestamp (epoch seconds)
  maxAge: number; // Threshold in seconds (default: 300s)
  expiresAt: number; // observedAt + maxAge
  ageSeconds: number; // receivedAt - observedAt
  freshnessStatus: FreshnessStatus;
  isAttestable: boolean;
}

export class FreshnessEngine {
  private defaultMaxAge: number;

  constructor(defaultMaxAgeSeconds = 300) {
    this.defaultMaxAge = defaultMaxAgeSeconds;
  }

  evaluate(observedAt: number, maxAgeSeconds?: number, receivedAtSeconds?: number): FreshnessEvaluation {
    const receivedAt = receivedAtSeconds || Math.floor(Date.now() / 1000);
    const maxAge = maxAgeSeconds || this.defaultMaxAge;
    const expiresAt = observedAt + maxAge;
    const ageSeconds = Math.max(0, receivedAt - observedAt);

    let freshnessStatus: FreshnessStatus;
    let isAttestable = false;

    if (ageSeconds <= 180) {
      // 0s to 3m
      freshnessStatus = "FRESH";
      isAttestable = true;
    } else if (ageSeconds <= maxAge) {
      // 3m to 5m
      freshnessStatus = "AGING";
      isAttestable = true;
    } else if (ageSeconds <= 900) {
      // 5m to 15m
      freshnessStatus = "STALE";
      isAttestable = false;
    } else {
      // > 15m
      freshnessStatus = "EXPIRED";
      isAttestable = false;
    }

    return {
      observedAt,
      receivedAt,
      maxAge,
      expiresAt,
      ageSeconds,
      freshnessStatus,
      isAttestable,
    };
  }
}
