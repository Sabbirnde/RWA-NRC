# API Reference & Endpoints

## Protocol Endpoints (`/api`)

- `GET /api/healthz` — System health check.
- `GET /api/protocol/summary` — Protocol dashboard summary & state postures.
- `GET /api/protocol/assets` — Monitored RWA asset registry.
- `GET /api/protocol/requests` — Asynchronous vault deposit & redemption requests.
- `POST /api/protocol/requests` — Create pending deposit/redemption request.
- `POST /api/protocol/requests/:requestId/process` — Run middleware validation, risk check & EIP-712 attestation.

## Firecrawl Endpoints

- `POST /api/firecrawl/search` — Search web sources for reference data.
- `POST /api/firecrawl/scrape` — Scrape clean markdown from selected source.
- `POST /api/firecrawl/extract` — Extract structured RWA NAV & custody fields.

## Webhooks

- `POST /api/webhooks/rwa-settlement` — Idempotent RWA settlement confirmation event listener.
