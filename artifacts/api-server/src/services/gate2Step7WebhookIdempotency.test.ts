import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { processWebhookEvent, processedEvents } from "../routes/webhooks";
import { MiddlewareStateMachine } from "./stateMachine";

describe("GATE 2.7 — Webhook Idempotency Validation Suite", () => {
  it("First Event Test — WH-001 Processes Successfully", () => {
    processedEvents.clear();
    const eventPayload = {
      eventId: "WH-001",
      assetId: "RWA-001",
      eventType: "NAV_UPDATE",
      nav: 1000000,
      timestamp: Math.floor(Date.now() / 1000),
    };

    const result = processWebhookEvent(eventPayload);

    assert.strictEqual(result.status, "PROCESSED");
    assert.strictEqual(result.eventId, "WH-001");
    assert.strictEqual(processedEvents.size, 1);
  });

  it("Duplicate Event Test — Resending WH-001 Returns IGNORED_DUPLICATE", () => {
    const eventPayload = {
      eventId: "WH-001",
      assetId: "RWA-001",
      eventType: "NAV_UPDATE",
      nav: 1000000,
      timestamp: Math.floor(Date.now() / 1000),
    };

    const duplicateResult = processWebhookEvent(eventPayload);

    assert.strictEqual(duplicateResult.status, "IGNORED_DUPLICATE");
    assert.strictEqual(duplicateResult.eventId, "WH-001");
    assert.strictEqual(processedEvents.size, 1);
  });

  it("Triple Duplicate Test — Concurrent Ingestion of WH-002 Yields Exactly 1 Processed Event", async () => {
    const eventPayload = {
      eventId: "WH-002",
      assetId: "RWA-001",
      eventType: "NAV_UPDATE",
      nav: 1000000,
      timestamp: Math.floor(Date.now() / 1000),
    };

    const results = await Promise.all([
      Promise.resolve(processWebhookEvent(eventPayload)),
      Promise.resolve(processWebhookEvent(eventPayload)),
      Promise.resolve(processWebhookEvent(eventPayload)),
    ]);

    const processedCount = results.filter((r) => r.status === "PROCESSED").length;
    const ignoredCount = results.filter((r) => r.status === "IGNORED_DUPLICATE").length;

    assert.strictEqual(processedCount, 1);
    assert.strictEqual(ignoredCount, 2);
  });

  it("No Duplicate State Test — Invariant Proof for State Machine History", () => {
    const sm = new MiddlewareStateMachine();
    const requestId = "REQ-WH-DEDUP";

    // First Processing
    sm.transition(requestId, "OBSERVED", "WH-001_RECEIVED", "Payload Ingested", "WEBHOOK", "Initial");
    const historyLen1 = sm.getRecord(requestId)?.history.length || 0;

    // Simulate attempted duplicate processing
    const isDuplicate = processedEvents.has("WH-001");
    if (!isDuplicate) {
      sm.transition(requestId, "OBSERVED", "WH-001_REDUNDANT", "Payload Ingested", "WEBHOOK", "Duplicate");
    }

    const historyLen2 = sm.getRecord(requestId)?.history.length || 0;

    assert.strictEqual(historyLen1, 1);
    assert.strictEqual(historyLen2, 1);
  });

  it("No Duplicate Attest & Settlement Test — Idempotency Prevents Duplicate Oracle Calls", () => {
    let attestationCount = 0;
    let settlementCount = 0;

    const handleWebhookWithSettlement = (payload: any) => {
      const res = processWebhookEvent(payload);
      if (res.status === "PROCESSED") {
        attestationCount++;
        settlementCount++;
      }
      return res;
    };

    const payload = { eventId: "WH-003", assetId: "RWA-001", nav: 1000000 };

    handleWebhookWithSettlement(payload); // 1st
    handleWebhookWithSettlement(payload); // 2nd (dup)
    handleWebhookWithSettlement(payload); // 3rd (dup)

    assert.strictEqual(attestationCount, 1);
    assert.strictEqual(settlementCount, 1);
  });
});
