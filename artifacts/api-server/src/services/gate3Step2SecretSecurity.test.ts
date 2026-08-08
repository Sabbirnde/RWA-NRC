import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FirecrawlProvider } from "./rwaProvider";

describe("GATE 3.2 — Firecrawl Secret Security Validation Suite", () => {
  const provider = new FirecrawlProvider("test-secret-key-12345");

  it("Test 1 — Backend API Response Does NOT Expose Secret Key to Frontend", async () => {
    const res = await provider.scrapeUrl("https://treasury.gov/rates/daily-treasury-yield");
    const jsonStr = JSON.stringify(res);

    assert.strictEqual(jsonStr.includes("test-secret-key-12345"), false);
    assert.strictEqual(jsonStr.includes("apiKey"), false);
    assert.strictEqual((res as any).apiKey, undefined);
  });

  it("Test 2 — Endpoint Payload Audit: Response Objects Never Leak Secret Key", async () => {
    const rawObs = await provider.getAssetState("RWA-001");
    const jsonStr = JSON.stringify(rawObs);

    assert.strictEqual(jsonStr.includes("test-secret-key-12345"), false);
    assert.strictEqual((rawObs as any).apiKey, undefined);
  });

  it("Test 3 — Frontend Bundle & Source Audit: Zero Public Secret Leaks in Frontend Source", () => {
    const frontendSrcDir = path.resolve(process.cwd(), "../../artifacts/claim-market/src");
    
    if (fs.existsSync(frontendSrcDir)) {
      const checkDirectory = (dir: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            checkDirectory(fullPath);
          } else if (entry.isFile() && /\.(tsx?|jsx?|html|css|json)$/.test(entry.name)) {
            const content = fs.readFileSync(fullPath, "utf-8");
            assert.strictEqual(
              content.includes("FIRECRAWL_API_KEY"),
              false,
              `Found FIRECRAWL_API_KEY in frontend file: ${fullPath}`
            );
            assert.strictEqual(
              content.includes("NEXT_PUBLIC_FIRECRAWL_API_KEY"),
              false,
              `Found NEXT_PUBLIC_FIRECRAWL_API_KEY in frontend file: ${fullPath}`
            );
            assert.strictEqual(
              content.includes("VITE_FIRECRAWL_API_KEY"),
              false,
              `Found VITE_FIRECRAWL_API_KEY in frontend file: ${fullPath}`
            );
          }
        }
      };

      checkDirectory(frontendSrcDir);
    }
  });

  it("Test 4 — Environment Security Audit: Backend Secret Exists Only in Node.js Runtime", () => {
    // Verify FIRECRAWL_API_KEY is isolated to Node.js backend process.env
    assert.strictEqual(process.env.NEXT_PUBLIC_FIRECRAWL_API_KEY, undefined);
    assert.strictEqual(process.env.VITE_FIRECRAWL_API_KEY, undefined);
  });
});
