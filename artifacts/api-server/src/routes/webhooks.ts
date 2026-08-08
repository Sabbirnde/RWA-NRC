import { Router } from "express";

const router = Router();

export interface WebhookRecord {
  eventId: string;
  assetId: string;
  eventType: string;
  settlementReference?: string;
  timestamp: number;
  payload: Record<string, any>;
  processed: boolean;
  processedAt: string;
}

const processedEvents = new Map<string, WebhookRecord>();

router.post("/webhooks/rwa-settlement", (req, res) => {
  const { eventId: inputEventId, assetId, event, eventType, settlementReference, timestamp } = req.body;

  // Auto-derive eventId if not explicitly provided
  const eventId =
    inputEventId ||
    settlementReference ||
    `${assetId || "RWA-001"}-${event || eventType || "SETTLEMENT_CONFIRMED"}-${timestamp || Date.now()}`;

  // Idempotency check: Do not process the same event twice
  if (processedEvents.has(eventId)) {
    const existing = processedEvents.get(eventId)!;
    res.status(200).json({
      status: "IGNORED_DUPLICATE",
      eventId,
      message: "Event already processed",
      record: existing,
    });
    return;
  }

  const record: WebhookRecord = {
    eventId,
    assetId: assetId || "RWA-001",
    eventType: event || eventType || "SETTLEMENT_CONFIRMED",
    settlementReference: settlementReference || "SET-001",
    timestamp: timestamp || Math.floor(Date.now() / 1000),
    payload: req.body,
    processed: true,
    processedAt: new Date().toISOString(),
  };

  processedEvents.set(eventId, record);

  res.status(200).json({
    status: "PROCESSED",
    eventId,
    record,
  });
});

router.get("/webhooks/rwa-settlement/history", (_req, res) => {
  res.json({
    count: processedEvents.size,
    events: Array.from(processedEvents.values()),
  });
});

export default router;
