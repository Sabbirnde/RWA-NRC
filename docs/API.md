# REST & Webhook API Reference Specifications

The RWA State Middleware exposes REST endpoints and webhook listeners for protocol telemetry, request processing, external data extraction, and settlement events.

---

## 📡 REST Endpoints

### Protocol Telemetry
- `GET /api/protocol/summary` — Returns TVL, Total Assets, NAV, Yield Rate, Pending/Claimable Deposits, Pending Redemptions, and Risk Posture.
- `GET /api/protocol/requests` — Lists all requests in flight with 8-step timeline statuses.
- `POST /api/protocol/requests` — Submits a new deposit or redemption request.
- `POST /api/protocol/requests/:requestId/process` — Executes full middleware pipeline (Ingest -> Normalize -> Validate -> Risk -> Attest).
- `POST /api/protocol/requests/:requestId/claim` — Finalizes claim and updates protocol state.

### Firecrawl Data Extraction
- `POST /api/firecrawl/search` — Searches reference web pages for Treasury yield settlement data.
- `POST /api/firecrawl/scrape` — Scrapes selected URLs and returns clean markdown reference info.
- `POST /api/firecrawl/extract` — Extracts normalized RWA reference state (`RWAAssetState`).

### Webhook Event Receiver
- `POST /api/webhooks/rwa-settlement` — Idempotent webhook receiver. Accepts settlement payloads, auto-derives `eventId` if missing, stores full event record, and ignores duplicate submissions.
- `GET /api/webhooks/rwa-settlement/history` — Lists all processed webhook records.
