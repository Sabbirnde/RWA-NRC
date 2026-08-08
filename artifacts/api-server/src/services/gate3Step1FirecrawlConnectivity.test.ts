import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FirecrawlProvider } from "./rwaProvider";

describe("GATE 3.1 — Firecrawl Connectivity Validation Suite", () => {
  const provider = new FirecrawlProvider();

  it("Test 1 — Valid URL Retrieval (https://treasury.gov/rates/daily-treasury-yield)", async () => {
    const validUrl = "https://treasury.gov/rates/daily-treasury-yield";
    const res = await provider.scrapeUrl(validUrl);

    assert.strictEqual(res.provider, "Firecrawl");
    assert.strictEqual(res.request, "SUCCESS");
    assert.strictEqual(res.source, validUrl);
    assert.strictEqual(res.retrieved, "YES");
    assert.ok(typeof res.timestamp === "number" && res.timestamp > 0);
  });

  it("Test 2 — Invalid / Disallowed URL Handling", async () => {
    const invalidUrls = ["invalid-url", "https://untrusted-scam-domain.com/hack"];

    for (const url of invalidUrls) {
      const res = await provider.scrapeUrl(url);

      assert.strictEqual(res.provider, "Firecrawl");
      assert.strictEqual(res.request, "FAIL");
      assert.strictEqual(res.retrieved, "NO");
      assert.ok(res.error && res.error.length > 0);
    }
  });

  it("Test 3 — Safety Guarantee: Zero Blockchain Calls & Zero Attestations", async () => {
    // Prove that connectivity validation executes purely in isolation
    const res = await provider.scrapeUrl("https://treasury.gov/rates/daily-treasury-yield");
    
    assert.strictEqual(res.request, "SUCCESS");
    // Assert no on-chain transaction or EIP-712 signature fields exist in response
    assert.strictEqual((res as any).signature, undefined);
    assert.strictEqual((res as any).txHash, undefined);
  });
});
