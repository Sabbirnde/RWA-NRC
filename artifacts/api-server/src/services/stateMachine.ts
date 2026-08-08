export type MiddlewareState =
  | "UNKNOWN"
  | "OBSERVED"
  | "VALIDATED"
  | "ATTESTABLE"
  | "ATTESTED"
  | "REJECTED"
  | "STALE"
  | "EXPIRED";

export interface StateTransitionLog {
  fromState: MiddlewareState;
  toState: MiddlewareState;
  event: string;
  condition: string;
  actor: string;
  timestamp: number;
  reason: string;
}

export interface StateMachineRecord {
  requestId: string;
  assetId: string;
  currentState: MiddlewareState;
  history: StateTransitionLog[];
  createdAt: number;
  updatedAt: number;
}

export class MiddlewareStateMachine {
  private allowedTransitions: Record<MiddlewareState, MiddlewareState[]> = {
    UNKNOWN: ["OBSERVED", "REJECTED"],
    OBSERVED: ["VALIDATED", "REJECTED", "STALE", "EXPIRED"],
    VALIDATED: ["ATTESTABLE", "REJECTED", "STALE", "EXPIRED"],
    ATTESTABLE: ["ATTESTED", "REJECTED", "STALE", "EXPIRED"],
    ATTESTED: [], // Terminal state
    REJECTED: [], // Terminal state
    STALE: ["OBSERVED"], // Can recover on new fresh observation
    EXPIRED: ["OBSERVED"], // Can recover on new fresh observation
  };

  private records: Map<string, StateMachineRecord> = new Map();

  createRecord(requestId: string, assetId: string): StateMachineRecord {
    const now = Math.floor(Date.now() / 1000);
    const record: StateMachineRecord = {
      requestId,
      assetId,
      currentState: "UNKNOWN",
      history: [],
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(requestId, record);
    return record;
  }

  getRecord(requestId: string): StateMachineRecord | undefined {
    return this.records.get(requestId);
  }

  transition(
    requestId: string,
    toState: MiddlewareState,
    event: string,
    condition: string,
    actor: string,
    reason: string
  ): StateMachineRecord {
    let record = this.records.get(requestId);
    if (!record) {
      record = this.createRecord(requestId, "RWA-001");
    }

    const fromState = record.currentState;
    const allowed = this.allowedTransitions[fromState] || [];

    // Check invalid / repeated transition
    if (!allowed.includes(toState)) {
      throw new Error(
        `INVALID_STATE_TRANSITION: Cannot transition request ${requestId} from state ${fromState} to ${toState}`
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const transitionLog: StateTransitionLog = {
      fromState,
      toState,
      event,
      condition,
      actor,
      timestamp: now,
      reason,
    };

    record.currentState = toState;
    record.history.push(transitionLog);
    record.updatedAt = now;

    return record;
  }
}
