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

export const processedEvents = new Map<string, WebhookRecord>();

export function processWebhookEvent(body: any): { status: "PROCESSED" | "IGNORED_DUPLICATE"; eventId: string; record: WebhookRecord } {
  const { eventId: inputEventId, assetId, event, eventType, settlementReference, timestamp } = body;

  const eventId =
    inputEventId ||
    settlementReference ||
    `${assetId || "RWA-001"}-${event || eventType || "SETTLEMENT_CONFIRMED"}-${timestamp || Date.now()}`;

  if (processedEvents.has(eventId)) {
    const existing = processedEvents.get(eventId)!;
    return {
      status: "IGNORED_DUPLICATE",
      eventId,
      record: existing,
    };
  }

  const record: WebhookRecord = {
    eventId,
    assetId: assetId || "RWA-001",
    eventType: event || eventType || "SETTLEMENT_CONFIRMED",
    settlementReference: settlementReference || "SET-001",
    timestamp: timestamp || Math.floor(Date.now() / 1000),
    payload: body,
    processed: true,
    processedAt: new Date().toISOString(),
  };

  processedEvents.set(eventId, record);

  return {
    status: "PROCESSED",
    eventId,
    record,
  };
}

router.post("/webhooks/rwa-settlement", (req, res) => {
  const result = processWebhookEvent(req.body);
  if (result.status === "IGNORED_DUPLICATE") {
    res.status(200).json({
      status: "IGNORED_DUPLICATE",
      eventId: result.eventId,
      message: "Event already processed",
      record: result.record,
    });
    return;
  }

  res.status(200).json({
    status: "PROCESSED",
    eventId: result.eventId,
    record: result.record,
  });
});

router.get("/webhooks/rwa-settlement/history", (_req, res) => {
  res.json({
    count: processedEvents.size,
    events: Array.from(processedEvents.values()),
  });
});

export default router;
