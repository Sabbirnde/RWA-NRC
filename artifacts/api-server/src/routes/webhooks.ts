import { Router } from "express";

const router = Router();
const processedEvents = new Set<string>();

router.post("/webhooks/rwa-settlement", (req, res) => {
  const { eventId, assetId, event, settlementReference, timestamp } = req.body;

  if (!eventId) {
    res.status(400).json({ error: "eventId is required" });
    return;
  }

  // Idempotency check
  if (processedEvents.has(eventId)) {
    res.status(200).json({
      status: "IGNORED_DUPLICATE",
      eventId,
      message: "Event already processed",
    });
    return;
  }

  processedEvents.add(eventId);

  res.status(200).json({
    status: "PROCESSED",
    eventId,
    assetId: assetId || "RWA-001",
    event: event || "SETTLEMENT_CONFIRMED",
    settlementReference: settlementReference || "SET-001",
    processedAt: new Date().toISOString(),
  });
});

export default router;
