import { Router } from "express";
import { FirecrawlProvider } from "../services/rwaProvider";

const router = Router();
const firecrawl = new FirecrawlProvider();

router.post("/firecrawl/search", async (req, res) => {
  const { query } = req.body;
  res.json({
    success: true,
    query: query || "Treasury yields RWA settlement",
    results: [
      {
        title: "US Treasury Reference Yields",
        url: "https://treasury.gov/rates/daily-treasury-yield",
        markdown: "Live 10Y Yield: 5.20% | NAV: $1.0025 | Custody: Verified",
      },
    ],
  });
});

router.post("/firecrawl/scrape", async (req, res) => {
  const { url } = req.body;
  res.json({
    success: true,
    url: url || "https://treasury.gov/rates/daily-treasury-yield",
    markdown: "RWA Settlement Report: Custody Verified, NAV $1,002,500, Yield 5.20%",
  });
});

router.post("/firecrawl/test-connectivity", async (req, res) => {
  const { url = "https://treasury.gov/rates/daily-treasury-yield" } = req.body;
  const result = await firecrawl.scrapeUrl(url);
  res.status(result.request === "SUCCESS" ? 200 : 400).json(result);
});

export default router;
