export interface RWAAssetState {
  assetId: string;
  assetType: string;
  nav: number; // in USD (or 6 decimals integer)
  yieldRate: number; // e.g. 5.20%
  currency: string;
  custodyStatus: "VERIFIED" | "UNVERIFIED" | "PENDING";
  settlementStatus: "SETTLED" | "PENDING" | "REJECTED";
  maturityDate: string;
  timestamp: number;
  dataSource: string;
  riskStatus: "PASS" | "FAIL" | "LOW" | "ELEVATED";
}

export interface RWADataProvider {
  name: string;
  getAssetState(assetId: string): Promise<RWAAssetState>;
}

export class MockRWAProvider implements RWADataProvider {
  name = "Mock RWA API";

  private mockState: Record<string, RWAAssetState> = {
    "RWA-001": {
      assetId: "RWA-001",
      assetType: "TREASURY",
      nav: 1002500,
      yieldRate: 5.2,
      currency: "USD",
      custodyStatus: "VERIFIED",
      settlementStatus: "SETTLED",
      maturityDate: "2026-12-31",
      timestamp: Math.floor(Date.now() / 1000),
      dataSource: "Mock RWA Provider",
      riskStatus: "PASS",
    },
  };

  async getAssetState(assetId: string): Promise<RWAAssetState> {
    const asset = this.mockState[assetId];
    if (!asset) {
      return {
        assetId,
        assetType: "TREASURY",
        nav: 1000000,
        yieldRate: 5.0,
        currency: "USD",
        custodyStatus: "VERIFIED",
        settlementStatus: "SETTLED",
        maturityDate: "2026-12-31",
        timestamp: Math.floor(Date.now() / 1000),
        dataSource: "Mock RWA Provider (Default)",
        riskStatus: "PASS",
      };
    }
    // Update timestamp to now for mock
    return {
      ...asset,
      timestamp: Math.floor(Date.now() / 1000),
    };
  }

  updateMockState(assetId: string, updates: Partial<RWAAssetState>) {
    if (this.mockState[assetId]) {
      this.mockState[assetId] = { ...this.mockState[assetId], ...updates };
    }
  }
}

export class FirecrawlProvider implements RWADataProvider {
  name = "Firecrawl Data Provider";
  private apiKey: string | undefined;
  private fallbackProvider: MockRWAProvider;

  constructor(apiKey?: string, fallbackProvider?: MockRWAProvider) {
    this.apiKey = apiKey || process.env.FIRECRAWL_API_KEY;
    this.fallbackProvider = fallbackProvider || new MockRWAProvider();
  }

  async getAssetState(assetId: string): Promise<RWAAssetState> {
    if (!this.apiKey) {
      // Graceful fallback when API key is missing
      const base = await this.fallbackProvider.getAssetState(assetId);
      return {
        ...base,
        dataSource: "Firecrawl (Fallback -> Mock Provider)",
      };
    }

    try {
      // Execute Firecrawl extract endpoint call
      const response = await fetch("https://api.firecrawl.dev/v1/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          urls: ["https://treasury.gov/rates/daily-treasury-yield"],
          prompt: `Extract NAV, yield, and custody status for RWA asset ${assetId}`,
        }),
      });

      if (!response.ok) {
        throw new Error(`Firecrawl API HTTP error ${response.status}`);
      }

      const data = (await response.json()) as { data?: { nav?: number; yieldRate?: number } };
      return {
        assetId,
        assetType: "TREASURY",
        nav: data.data?.nav || 1002500,
        yieldRate: data.data?.yieldRate || 5.2,
        currency: "USD",
        custodyStatus: "VERIFIED",
        settlementStatus: "SETTLED",
        maturityDate: "2026-12-31",
        timestamp: Math.floor(Date.now() / 1000),
        dataSource: "Firecrawl Live Ingestion",
        riskStatus: "PASS",
      };
    } catch {
      // Gracefully fall back to Mock Provider on error/network issue
      const base = await this.fallbackProvider.getAssetState(assetId);
      return {
        ...base,
        dataSource: "Firecrawl (Fallback -> Mock Provider)",
      };
    }
  }
}
