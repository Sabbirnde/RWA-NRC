import { Router, type IRouter } from "express";
import { FirecrawlProvider } from "../services/rwaProvider";
import { ValidationEngine } from "../services/validationEngine";
import { RiskEngine } from "../services/riskEngine";
import { AttestationService } from "../services/attestationService";
import {
  BuyProtocolClaimBody,
  BuyProtocolClaimResponse,
  BuyProtocolClaimParams,
  ClaimProtocolRequestParams,
  ClaimProtocolRequestResponse,
  CreateProtocolRequestBody,
  CreateProtocolRequestResponse,
  GetProtocolSummaryResponse,
  ListProtocolClaimsResponse,
  ListProtocolRequestsResponse,
  ListRwaAssetsResponse,
  ListProtocolClaimParams,
  ListProtocolClaimBody,
  ListProtocolClaimResponse,
  ProcessProtocolRequestBody,
  ProcessProtocolRequestParams,
  ProcessProtocolRequestResponse,
  ProtocolRequestInputKind,
  SetProtocolFailureModeBody,
  SetProtocolFailureModeResponse,
  ResetProtocolDemoResponse,
} from "@workspace/api-zod";

type StepState = "complete" | "active" | "blocked" | "waiting";
type RequestStatus = "PENDING" | "CLAIMABLE" | "FINALIZED" | "EXCEPTION";

type RequestStep = {
  label: string;
  state: StepState;
  detail?: string;
};

type ProtocolRequest = {
  id: string;
  kind: "deposit" | "redeem";
  owner: string;
  amount: number;
  assetId: string;
  status: RequestStatus;
  createdAt: string;
  steps: RequestStep[];
  message: string;
  claimableAmount: number;
  claimed?: boolean;
};

type RwaAsset = {
  assetId: string;
  name: string;
  assetType: string;
  nav: number;
  yieldRate: number;
  custodyStatus: string;
  settlementStatus: string;
  riskStatus: string;
  updatedAt: string;
  dataSource: string;
};

type ProtocolClaim = {
  id: string;
  requestId: string;
  owner: string;
  faceValue: number;
  price: number;
  discount: number;
  settlement: string;
  status: "LISTED" | "SOLD" | "SETTLED";
  assetId: string;
};

const protocolState = {
  failureMode: false,
  sequence: 2,
  claimSequence: 2,
  lastEvent: "Attestation accepted for REQ-0002",
  assets: [
    {
      assetId: "RWA-001",
      name: "US Treasury Demo Asset",
      assetType: "TREASURY",
      nav: 1002500,
      yieldRate: 5.2,
      custodyStatus: "VERIFIED",
      settlementStatus: "SETTLED",
      riskStatus: "LOW",
      updatedAt: new Date().toISOString(),
      dataSource: "Mock RWA Provider",
    },
  ] as RwaAsset[],
  requests: [] as ProtocolRequest[],
  claims: [] as ProtocolClaim[],
};

function createSteps(
  terminal: "pending" | "claimable" | "blocked" | "finalized",
): RequestStep[] {
  const labels = [
    "Request created",
    "RWA data received",
    "Validation passed",
    "Risk assessment",
    "Attestation generated",
    "Blockchain updated",
    "Claimable",
  ];
  const completeUntil =
    terminal === "pending"
      ? 0
      : terminal === "blocked"
        ? 1
        : terminal === "claimable" || terminal === "finalized"
          ? 7
          : 7;

  return labels.map((label, index) => {
    if (terminal === "blocked" && index === 2) {
      return {
        label,
        state: "blocked",
        detail: "External data failed freshness or custody validation.",
      };
    }
    if (terminal === "finalized" && index === 6) {
      return { label, state: "complete", detail: "Claim finalized by owner." };
    }
    if (index < completeUntil) return { label, state: "complete" };
    if (index === completeUntil && terminal === "pending") {
      return { label, state: "active", detail: "Waiting for RWA settlement." };
    }
    return { label, state: "waiting" };
  });
}

function seedState(): void {
  const now = new Date().toISOString();
  protocolState.failureMode = false;
  protocolState.sequence = 3;
  protocolState.claimSequence = 2;
  protocolState.lastEvent = "Attestation accepted for REQ-0002";
  protocolState.assets = [
    {
      assetId: "RWA-001",
      name: "US Treasury Demo Asset",
      assetType: "TREASURY",
      nav: 1002500,
      yieldRate: 5.2,
      custodyStatus: "VERIFIED",
      settlementStatus: "SETTLED",
      riskStatus: "LOW",
      updatedAt: now,
      dataSource: "Mock RWA Provider",
    },
  ];
  protocolState.requests = [
    {
      id: "REQ-0001",
      kind: "deposit",
      owner: "0xAlice...9F2A",
      amount: 1000,
      assetId: "RWA-001",
      status: "PENDING",
      createdAt: now,
      steps: createSteps("pending"),
      message: "Waiting for RWA settlement.",
      claimableAmount: 0,
    },
    {
      id: "REQ-0002",
      kind: "deposit",
      owner: "0xAlice...9F2A",
      amount: 1000,
      assetId: "RWA-001",
      status: "CLAIMABLE",
      createdAt: now,
      steps: createSteps("claimable"),
      message: "Attestation accepted. Shares are ready to claim.",
      claimableAmount: 1000,
    },
  ];
  protocolState.claims = [
    {
      id: "CLM-0001",
      requestId: "REQ-0002",
      owner: "0xAlice...9F2A",
      faceValue: 1000,
      price: 980,
      discount: 2,
      settlement: "T+2",
      status: "LISTED",
      assetId: "RWA-001",
    },
  ];
}

seedState();

function getSummary() {
  const asset = protocolState.assets[0];
  return GetProtocolSummaryResponse.parse({
    tvl: 12468000,
    totalAssets: 12500000,
    pendingDeposits: protocolState.requests.filter(
      (request) => request.kind === "deposit" && request.status === "PENDING",
    ).length,
    claimableDeposits: protocolState.requests.filter(
      (request) => request.kind === "deposit" && request.status === "CLAIMABLE",
    ).length,
    pendingRedemptions: protocolState.requests.filter(
      (request) => request.kind === "redeem" && request.status === "PENDING",
    ).length,
    nav: asset?.nav ?? 0,
    yieldRate: asset?.yieldRate ?? 0,
    risk: protocolState.failureMode ? "ELEVATED" : "LOW",
    oracleStatus: protocolState.failureMode ? "BLOCKED" : "ATTESTED",
    middlewareStatus: protocolState.failureMode ? "VALIDATION_BLOCKED" : "HEALTHY",
    firecrawlStatus: "NOT_CONNECTED",
    failureMode: protocolState.failureMode,
    lastEvent: protocolState.lastEvent,
  });
}

const router: IRouter = Router();

router.get("/protocol/summary", (_req, res) => {
  res.json(getSummary());
});

router.get("/protocol/assets", (_req, res) => {
  res.json(ListRwaAssetsResponse.parse(protocolState.assets));
});

router.get("/protocol/requests", (_req, res) => {
  res.json(ListProtocolRequestsResponse.parse(protocolState.requests));
});

router.post("/protocol/requests", (req, res) => {
  const body = CreateProtocolRequestBody.parse(req.body);
  const id = `REQ-${String(protocolState.sequence).padStart(4, "0")}`;
  protocolState.sequence += 1;
  const request: ProtocolRequest = {
    id,
    kind: body.kind === ProtocolRequestInputKind.redeem ? "redeem" : "deposit",
    owner: body.owner,
    amount: body.amount,
    assetId: "RWA-001",
    status: "PENDING",
    createdAt: new Date().toISOString(),
    steps: createSteps("pending"),
    message: "Waiting for RWA settlement.",
    claimableAmount: 0,
  };
  protocolState.requests.unshift(request);
  protocolState.lastEvent = `${request.kind === "deposit" ? "Deposit" : "Redeem"} request ${id} created`;
  res.status(201).json(CreateProtocolRequestResponse.parse(request));
});

router.post("/protocol/requests/:requestId/process", async (req, res) => {
  const params = ProcessProtocolRequestParams.parse(req.params);
  const body = ProcessProtocolRequestBody.parse(req.body);
  const request = protocolState.requests.find((item) => item.id === params.requestId);
  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  const firecrawl = new FirecrawlProvider();
  const validationEngine = new ValidationEngine();
  const riskEngine = new RiskEngine();
  const attestationService = new AttestationService();

  const assetState = await firecrawl.getAssetState(request.assetId || "RWA-001");
  const validationResult = validationEngine.validate(assetState);
  const riskResult = riskEngine.evaluate(assetState, validationResult);

  const shouldBlock = body.mode === "invalid" || protocolState.failureMode || riskResult.status === "FAIL";

  if (shouldBlock) {
    request.status = "EXCEPTION";
    request.claimableAmount = 0;
    request.steps = createSteps("blocked");
    request.message = `Settlement blocked: ${riskResult.reasons.length > 0 ? riskResult.reasons.join(", ") : "external data failed validation."}`;
    protocolState.lastEvent = `Attestation rejected for ${request.id}`;
  } else {
    await attestationService.generateAttestation(
      request.assetId || "RWA-001",
      request.id,
      "SETTLED",
      assetState.nav,
      assetState.yieldRate,
      true
    );
    request.status = "CLAIMABLE";
    request.claimableAmount = request.amount;
    request.steps = createSteps("claimable");
    request.message =
      request.kind === "deposit"
        ? "EIP-712 Attestation accepted. Shares are ready to claim."
        : "EIP-712 Attestation accepted. Assets are ready to claim.";
    protocolState.lastEvent = `Attestation accepted for ${request.id}`;
  }
  res.json(ProcessProtocolRequestResponse.parse(request));
});

router.post("/protocol/requests/:requestId/claim", (req, res) => {
  const params = ClaimProtocolRequestParams.parse(req.params);
  const request = protocolState.requests.find((item) => item.id === params.requestId);
  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  if (request.status !== "CLAIMABLE" || request.claimed) {
    res.status(409).json({ error: "Request is not claimable" });
    return;
  }
  request.claimed = true;
  request.status = "FINALIZED";
  request.steps = createSteps("finalized");
  request.message =
    request.kind === "deposit"
      ? "Shares finalized to the request owner."
      : "Assets finalized to the request owner.";
  protocolState.lastEvent = `${request.id} finalized by ${request.owner}`;
  res.json(ClaimProtocolRequestResponse.parse(request));
});

router.get("/protocol/claims", (_req, res) => {
  res.json(ListProtocolClaimsResponse.parse(protocolState.claims));
});

router.post("/protocol/claims/:claimId/list", (req, res) => {
  const params = ListProtocolClaimParams.parse(req.params);
  const body = ListProtocolClaimBody.parse(req.body);
  const claim = protocolState.claims.find((item) => item.id === params.claimId);
  if (!claim) {
    res.status(404).json({ error: "Claim not found" });
    return;
  }
  if (claim.status !== "LISTED") {
    res.status(409).json({ error: "Claim is not transferable" });
    return;
  }
  claim.price = body.price;
  claim.discount = Math.round((1 - body.price / claim.faceValue) * 10000) / 100;
  protocolState.lastEvent = `${claim.id} listed at $${claim.price}`;
  res.json(ListProtocolClaimResponse.parse(claim));
});

router.post("/protocol/claims/:claimId/buy", (req, res) => {
  const params = BuyProtocolClaimParams.parse(req.params);
  const body = BuyProtocolClaimBody.parse(req.body);
  const claim = protocolState.claims.find((item) => item.id === params.claimId);
  if (!claim) {
    res.status(404).json({ error: "Claim not found" });
    return;
  }
  if (claim.status !== "LISTED") {
    res.status(409).json({ error: "Claim is no longer listed" });
    return;
  }
  if (claim.owner === body.buyer) {
    res.status(409).json({ error: "Claim owner cannot buy their own claim" });
    return;
  }
  claim.owner = body.buyer;
  claim.status = "SOLD";
  protocolState.lastEvent = `${claim.id} purchased by ${body.buyer}`;
  res.json(BuyProtocolClaimResponse.parse(claim));
});

router.post("/protocol/demo/failure", (req, res) => {
  const body = SetProtocolFailureModeBody.parse(req.body);
  protocolState.failureMode = body.enabled;
  const asset = protocolState.assets[0];
  if (asset) {
    asset.custodyStatus = body.enabled ? "UNVERIFIED" : "VERIFIED";
    asset.riskStatus = body.enabled ? "HIGH" : "LOW";
    asset.settlementStatus = body.enabled ? "STALE" : "SETTLED";
    asset.updatedAt = new Date().toISOString();
  }
  protocolState.lastEvent = body.enabled
    ? "Failure simulation enabled: settlement safety lock engaged"
    : "Failure simulation disabled: validation path restored";
  res.json(SetProtocolFailureModeResponse.parse(getSummary()));
});

router.post("/protocol/demo/reset", (_req, res) => {
  seedState();
  res.json(ResetProtocolDemoResponse.parse(getSummary()));
});

export default router;