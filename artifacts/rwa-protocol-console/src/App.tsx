import { type ReactNode, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Activity, AlertTriangle, ArrowDownToLine, ArrowRight, ArrowUpRight, BadgeCheck, BarChart3,
  BookOpen, Boxes, Check, CheckCircle2, ChevronRight, CircleAlert, CircleDashed, Clock3, Copy,
  Database, FileCheck2, Gauge, Info, Layers3, LockKeyhole, Menu, Play, RefreshCw,
  RotateCcw, Route as RouteIcon, ServerCog, ShieldCheck, SlidersHorizontal, Sparkles,
  UserRound, WalletCards, X, Zap,
} from 'lucide-react';
import {
  getGetProtocolSummaryQueryKey, getListProtocolClaimsQueryKey,
  getListProtocolRequestsQueryKey, getListRwaAssetsQueryKey,
  useBuyProtocolClaim, useClaimProtocolRequest, useCreateProtocolRequest,
  useGetProtocolSummary, useListProtocolClaims, useListProtocolClaim,
  useListProtocolRequests, useListRwaAssets, useProcessProtocolRequest,
  useResetProtocolDemo, useSetProtocolFailureMode,
} from '@workspace/api-client-react';
import type { ProtocolClaim, ProtocolRequest, RwaAsset } from '@workspace/api-client-react';
import { Link, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';

const queryClient = new QueryClient();

const navItems = [
  { href: '/', label: 'Protocol overview', icon: Activity },
  { href: '/demo', label: 'Presenter runbook', icon: Play },
  { href: '/vault', label: 'Vault accounting', icon: WalletCards },
  { href: '/assets', label: 'RWA asset monitor', icon: Boxes },
  { href: '/requests', label: 'Request processing', icon: RouteIcon },
  { href: '/claims', label: 'Fixed-price claims', icon: ArrowUpRight },
  { href: '/monitor', label: 'Middleware & controls', icon: ServerCog },
];

const money = (value = 0) => `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const count = (value = 0) => value.toLocaleString();
const pct = (value = 0) => `${(value * 100).toFixed(2)}%`;
const shortDate = (value?: string) => value ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const tone = (value = '') => {
  const v = value.toLowerCase();
  if (v.includes('fail') || v.includes('invalid') || v.includes('blocked') || v.includes('stale')) return 'danger';
  if (v.includes('pending') || v.includes('review') || v.includes('wait')) return 'warn';
  if (v.includes('ready') || v.includes('valid') || v.includes('active') || v.includes('attest') || v.includes('settled') || v.includes('clear')) return 'good';
  return 'neutral';
};

function StatusPill({ value, dot = true }: { value?: string; dot?: boolean }) {
  const label = value || 'Unknown';
  return <span className={`pill pill-${tone(label)}`}>{dot && <i className="pill-dot" />}{label}</span>;
}

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

function ErrorState({ message = 'Reference service is unavailable.' }: { message?: string }) {
  return <div className="empty-state"><CircleAlert size={24} /><strong>Unable to load this view</strong><span>{message} Safe action: hold settlement and retry.</span></div>;
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const summary = useGetProtocolSummary({ query: { queryKey: getGetProtocolSummaryQueryKey(), refetchInterval: 12000 } });
  const failure = summary.data?.failureMode;
  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'is-open' : ''}`}>
      <div className="brand"><div className="brand-mark"><span /><span /><span /></div><div><b>RWA / PROTOCOL</b><small>operator console</small></div></div>
      <div className="rail-label">Control plane</div>
      <nav>{navItems.map(item => {
        const Icon = item.icon; const active = location === item.href;
        return <Link key={item.href} href={item.href} onClick={() => setMobileOpen(false)} className={`nav-item ${active ? 'active' : ''}`} data-testid={`link-nav-${item.label.toLowerCase().replaceAll(' ', '-')}`}>
          <Icon size={16} /><span>{item.label}</span>{active && <ChevronRight size={14} className="nav-chevron" />}
        </Link>;
      })}</nav>
      <div className="sidebar-foot">
        <div className="network"><span className="live-dot" />Conference demo <span className="network-tag">LIVE</span></div>
        <div className="network-meta"><span>Ethereum / Sepolia</span><span>Block 19,482,106</span></div>
        <div className="sidebar-source"><Database size={13} /> External Reference Data<br /><span>Firecrawl · mock-provider values</span></div>
      </div>
    </aside>
    <main className="main">
      <header className="topbar">
        <Button variant="ghost" size="icon" className="mobile-menu" onClick={() => setMobileOpen(v => !v)} data-testid="button-mobile-menu"><Menu size={19} /></Button>
        <div className="breadcrumbs"><span>RWA Protocol</span><ChevronRight size={13} /><b>{navItems.find(n => n.href === location)?.label || 'Console'}</b></div>
        <div className="top-actions"><div className={`system-state ${failure ? 'danger-text' : ''}`}><span className={failure ? 'state-dot danger' : 'state-dot'} />{failure ? 'Settlement hold active' : 'Safe to process'}</div><Button variant="outline" size="sm" onClick={() => window.location.reload()} data-testid="button-refresh"><RefreshCw size={14} /> Refresh</Button></div>
      </header>
      {failure && <div className="failure-banner"><AlertTriangle size={16} /><span><b>External data failure simulation enabled.</b> New requests remain pending until validation passes.</span><Link href="/monitor">Review controls <ArrowUpRight size={13} /></Link></div>}
      <div className="page-wrap">{children}</div>
    </main>
  </div>;
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action && <div className="header-action">{action}</div>}</div>;
}

function MetricCard({ label, value, note, accent = '' }: { label: string; value: string; note?: string; accent?: string }) {
  return <div className={`metric-card ${accent}`}><div className="metric-label">{label}</div><div className="metric-value">{value}</div>{note && <div className="metric-note">{note}</div>}</div>;
}

function SectionTitle({ icon: Icon, title, meta, action }: { icon: typeof Activity; title: string; meta?: string; action?: ReactNode }) {
  return <div className="section-title"><div className="title-left"><Icon size={16} /><h2>{title}</h2>{meta && <span>{meta}</span>}</div>{action}</div>;
}

function SummaryStrip() {
  const { data, isLoading, isError } = useGetProtocolSummary({ query: { queryKey: getGetProtocolSummaryQueryKey(), refetchInterval: 12000 } });
  if (isError) return <ErrorState />;
  if (isLoading || !data) return <div className="metric-grid">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="metric-card" />)}</div>;
  return <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
    <MetricCard label="Total value locked" value={money(data.tvl)} note="Collateral held in vault" accent="accent-teal" />
    <MetricCard label="Total assets" value={money(data.totalAssets)} note="Underlying RWA valuation" />
    <MetricCard label="Current NAV" value={money(data.nav)} note={`Yield rate ${pct(data.yieldRate)}`} />
    <MetricCard label="Pending deposits" value={count(data.pendingDeposits)} note={`${count(data.claimableDeposits)} claimable`} accent="accent-amber" />
    <MetricCard label="Pending redemptions" value={count(data.pendingRedemptions)} note={`RWA risk: ${data.risk}`} accent="accent-slate" />
  </div>;
}

function Pipeline({ compact = false }: { compact?: boolean }) {
  const stages = [
    ['01', 'Normalize', 'External reference data', Database],
    ['02', 'Validate', 'Schema + source checks', FileCheck2],
    ['03', 'Freshness', 'Age threshold < 15m', Clock3],
    ['04', 'Risk', 'Conservative policy gate', ShieldCheck],
    ['05', 'Attest', 'Signed settlement proof', BadgeCheck],
  ] as const;
  return <div className={`pipeline ${compact ? 'compact' : ''}`}>{stages.map(([num, label, detail, Icon], i) => <div className="pipeline-stage" key={label}><div className={`stage-icon stage-${i}`}><Icon size={16} /></div><div><div className="stage-name"><span>{num}</span>{label}</div>{!compact && <div className="stage-detail">{detail}</div>}</div>{i < stages.length - 1 && <div className="stage-line" />}</div>)}</div>;
}

function Home() {
  const { data, isLoading } = useGetProtocolSummary({ query: { queryKey: getGetProtocolSummaryQueryKey(), refetchInterval: 12000 } });
  const requests = useListProtocolRequests({ query: { queryKey: getListProtocolRequestsQueryKey() } });
  const [demoMode, setDemoMode] = useState<'valid' | 'invalid'>('valid');
  const process = useProcessProtocolRequest();
  const qc = useQueryClient();
  const latest = requests.data?.slice(0, 4) || [];
  const processRequest = (id: string) => process.mutate({ requestId: id, data: { mode: demoMode } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListProtocolRequestsQueryKey() }); qc.invalidateQueries({ queryKey: getGetProtocolSummaryQueryKey() }); } });
  return <><PageHeader eyebrow="Live settlement view" title="Proof before liquidity." description="A controlled path from external reference data to claimable settlement. Uncertainty is visible by design." action={<div className="demo-control"><span className="control-label">Demo input</span><Button size="sm" variant={demoMode === 'valid' ? 'default' : 'outline'} onClick={() => setDemoMode('valid')} data-testid="button-demo-valid"><Check size={13} /> Valid</Button><Button size="sm" variant={demoMode === 'invalid' ? 'destructive' : 'outline'} onClick={() => setDemoMode('invalid')} data-testid="button-demo-invalid"><X size={13} /> Invalid</Button></div>} /><SummaryStrip />
    <div className="hero-grid">
      <section className="panel protocol-panel"><SectionTitle icon={RouteIcon} title="Settlement protocol" meta="ERC-7540-style lifecycle" /><div className="protocol-copy"><div><h3>Every request earns its claim.</h3><p>Reference data is normalized, tested for freshness, held against risk policy, then attested. A request only becomes claimable after the full chain clears.</p></div><div className="guardrail"><LockKeyhole size={15} /><span>Fail closed: delay is safer than settle.</span></div></div><Pipeline /></section>
      <section className="panel snapshot-panel"><SectionTitle icon={Gauge} title="System posture" meta="Live telemetry" /><div className="posture-list">{[['Oracle', data?.oracleStatus], ['Middleware', data?.middlewareStatus], ['Firecrawl', data?.firecrawlStatus], ['Risk gate', data?.risk]].map(([label, value]) => <div className="posture-row" key={label}><span>{label}</span><StatusPill value={value} /></div>)}</div><div className="last-event"><span>Last protocol event</span><b>{data?.lastEvent || 'Waiting for telemetry…'}</b></div></section>
    </div>
    <section className="panel request-panel"><SectionTitle icon={Activity} title="Requests in flight" meta={`${requests.data?.length || 0} tracked`} action={<Link className="inline-link" href="/requests">Open request timeline <ArrowUpRight size={13} /></Link>} />{requests.isLoading ? <div className="table-skeleton">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} />)}</div> : requests.isError ? <ErrorState /> : latest.length === 0 ? <div className="empty-state"><CircleDashed size={23} /><strong>No requests in the queue</strong><span>Create a deposit or redemption to watch the protocol work.</span><Link href="/vault" className="inline-link">Open vault accounting <ArrowUpRight size={13} /></Link></div> : <RequestTable rows={latest} onProcess={processRequest} processing={process.isPending} />}</section>
  </>;
}

function RequestTable({ rows, onProcess, processing }: { rows: ProtocolRequest[]; onProcess?: (id: string) => void; processing?: boolean }) {
  return <div className="table-wrap"><table><thead><tr><th>Request</th><th>Owner</th><th>Amount</th><th>Stage</th><th>Created</th><th /></tr></thead><tbody>{rows.map(row => <tr key={row.id} data-testid={`row-request-${row.id}`}><td><div className="request-id"><span className={`kind-marker ${row.kind === 'deposit' ? 'deposit' : 'redeem'}`}>{row.kind === 'deposit' ? 'D' : 'R'}</span><div><b>{row.id}</b><small>{row.kind} · {row.assetId}</small></div></div></td><td className="mono">{row.owner}</td><td className="amount">{money(row.amount)}</td><td><StatusPill value={row.status} /></td><td className="muted">{shortDate(row.createdAt)}</td><td>{onProcess && (row.status.toLowerCase().includes('pending') || row.status.toLowerCase().includes('queued')) && <Button variant="outline" size="sm" disabled={processing} onClick={() => onProcess(row.id)} data-testid={`button-process-${row.id}`}>{processing ? 'Running…' : 'Process'}</Button>}</td></tr>)}</tbody></table></div>;
}

function Vault() {
  const [kind, setKind] = useState<'deposit' | 'redeem'>('deposit');
  const [amount, setAmount] = useState('25000');
  const [owner, setOwner] = useState('operator@northstar.capital');
  const [created, setCreated] = useState<ProtocolRequest | null>(null);
  const summary = useGetProtocolSummary({ query: { queryKey: getGetProtocolSummaryQueryKey(), refetchInterval: 12000 } });
  const create = useCreateProtocolRequest();
  const qc = useQueryClient();
  const submit = () => create.mutate({ data: { kind, amount: Number(amount), owner } }, { onSuccess: request => { setCreated(request); qc.invalidateQueries({ queryKey: getListProtocolRequestsQueryKey() }); qc.invalidateQueries({ queryKey: getGetProtocolSummaryQueryKey() }); } });
  return <><PageHeader eyebrow="Vault accounting" title="A request is not a balance." description="Track vault obligations independently from settled assets. Create a request, then process it through the protocol gate." action={<div className="source-note"><Database size={14} /><span>Accounting source<br /><b>Protocol ledger · live</b></span></div>} /><SummaryStrip />
    <div className="vault-grid"><section className="panel create-panel"><SectionTitle icon={Sparkles} title="Create a protocol request" meta="Demo operator action" /><div className="segmented"><button className={kind === 'deposit' ? 'selected' : ''} onClick={() => setKind('deposit')} data-testid="button-kind-deposit"><ArrowDownToLine size={15} /> Deposit</button><button className={kind === 'redeem' ? 'selected' : ''} onClick={() => setKind('redeem')} data-testid="button-kind-redeem"><ArrowUpRight size={15} /> Redemption</button></div><label>Owner / institutional account<Input value={owner} onChange={e => setOwner(e.target.value)} data-testid="input-owner" /></label><label>Request amount (USD)<Input type="number" min="1" value={amount} onChange={e => setAmount(e.target.value)} data-testid="input-amount" /></label><div className="form-note"><Info size={14} /><span>Asset routing is selected by the protocol’s current NAV. Requests remain pending until external data clears validation.</span></div><Button onClick={submit} disabled={create.isPending || !owner || Number(amount) < 1} data-testid="button-create-request">{create.isPending ? 'Submitting to queue…' : 'Submit request'} <ChevronRight size={15} /></Button>{create.isError && <div className="form-error">Request was not accepted. Retry when the reference service is available.</div>}{created && <div className="success-note"><Check size={15} /><span>Request <b>{created.id}</b> entered the queue.</span></div>}</section>
      <section className="panel accounting-panel"><SectionTitle icon={BarChart3} title="Accounting lanes" meta="USD equivalent" /><div className="accounting-lanes"><div className="lane"><div><span>Assets held</span><b>Current NAV</b></div><strong>{money(summary.data?.totalAssets)}</strong></div><div className="lane"><div><span>Claims payable</span><b>Pending deposits</b></div><strong className="amber">{count(summary.data?.pendingDeposits)}</strong></div><div className="lane"><div><span>Redemption queue</span><b>Pending redemptions</b></div><strong>{count(summary.data?.pendingRedemptions)}</strong></div></div><div className="accounting-foot"><LockKeyhole size={15} /><span>Balances refresh from the protocol summary every 12 seconds.</span></div></section></div>
    <section className="panel lifecycle-panel"><SectionTitle icon={Layers3} title="Lifecycle model" meta="The safe path is intentionally sequential" /><Pipeline /></section>
  </>;
}

function Assets() {
  const { data, isLoading, isError } = useListRwaAssets({ query: { queryKey: getListRwaAssetsQueryKey() } });
  const assets = Array.isArray(data) ? data : [];
  return <><PageHeader eyebrow="RWA asset monitor" title="Collateral, with provenance." description="A single monitor for NAV, custody, settlement and risk posture across tokenized real-world assets." action={<div className="source-note"><Database size={14} /><span>External Reference Data<br /><b>Firecrawl · mock-provider values</b></span></div>} /><div className="asset-overview"><div className="asset-count"><span>Monitored assets</span><b>{assets.length.toString().padStart(2, '0')}</b></div><div className="asset-rule"><ShieldCheck size={17} /><span>Settlement only proceeds when custody, source freshness and risk status agree.</span></div></div><section className="panel asset-panel"><SectionTitle icon={Boxes} title="Asset registry" meta="Normalized reference view" />{isLoading ? <div className="asset-grid">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="asset-card" />)}</div> : isError ? <ErrorState /> : assets.length ? <div className="asset-grid">{assets.map(asset => <AssetCard key={asset.assetId} asset={asset} />)}</div> : <div className="empty-state"><Boxes size={23} /><strong>No monitored assets</strong><span>Asset registry is empty. Check the external reference data connection.</span></div>}</section></>;
}

function AssetCard({ asset }: { asset: RwaAsset }) {
  return <article className="asset-card" data-testid={`card-asset-${asset.assetId}`}><div className="asset-card-top"><div className="asset-icon">{asset.assetType.slice(0, 2).toUpperCase()}</div><StatusPill value={asset.riskStatus} /></div><h3>{asset.name}</h3><div className="asset-id mono">{asset.assetId}</div><div className="asset-values"><div><span>NAV</span><b>{money(asset.nav)}</b></div><div><span>Yield</span><b>{pct(asset.yieldRate)}</b></div></div><div className="asset-statuses"><div><span>Custody</span><StatusPill value={asset.custodyStatus} dot={false} /></div><div><span>Settlement</span><StatusPill value={asset.settlementStatus} dot={false} /></div></div><div className="asset-footer"><span><Database size={12} /> {asset.dataSource}</span><span>Updated {shortDate(asset.updatedAt)}</span></div></article>;
}

function Requests() {
  const { data, isLoading, isError } = useListProtocolRequests({ query: { queryKey: getListProtocolRequestsQueryKey() } });
  const process = useProcessProtocolRequest(); const claim = useClaimProtocolRequest(); const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: getListProtocolRequestsQueryKey() }); qc.invalidateQueries({ queryKey: getGetProtocolSummaryQueryKey() }); };
  const [mode, setMode] = useState<'valid' | 'invalid'>('valid');
  const rows = Array.isArray(data) ? data : [];
  return <><PageHeader eyebrow="Request processing" title="Operate the queue." description="Review each lifecycle step, run validation deliberately, and claim only after attestation is complete." action={<div className="demo-control"><span className="control-label">Process mode</span><Button size="sm" variant={mode === 'valid' ? 'default' : 'outline'} onClick={() => setMode('valid')} data-testid="button-process-mode-valid">Valid</Button><Button size="sm" variant={mode === 'invalid' ? 'destructive' : 'outline'} onClick={() => setMode('invalid')} data-testid="button-process-mode-invalid">Invalid</Button></div>} />{isLoading ? <div className="panel loading-panel">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} />)}</div> : isError ? <ErrorState /> : rows.length === 0 ? <div className="panel"><div className="empty-state"><RouteIcon size={24} /><strong>The queue is clear</strong><span>No asynchronous requests are waiting for middleware processing.</span><Link href="/vault" className="inline-link">Create a request <ArrowUpRight size={13} /></Link></div></div> : <div className="request-stack">{rows.map(row => <RequestTimeline key={row.id} row={row} onProcess={() => process.mutate({ requestId: row.id, data: { mode } }, { onSuccess: refresh })} onClaim={() => claim.mutate({ requestId: row.id }, { onSuccess: refresh })} processing={process.isPending} claiming={claim.isPending} />)}</div>}</>;
}

type DemoStep = {
  number: string;
  eyebrow: string;
  title: string;
  summary: string;
  note: string;
  audience: string;
  truth: string;
};

const demoSteps: DemoStep[] = [
  {
    number: '01',
    eyebrow: 'Set the stakes',
    title: 'The temporal mismatch',
    summary: 'Traditional vaults assume a deposit settles immediately. Real-world assets do not.',
    note: 'Traditional vaults assume atomic execution. RWA settlement is asynchronous, so the architecture has to make time visible.',
    audience: 'The problem is not tokenization alone. It is the gap between on-chain intent and off-chain settlement.',
    truth: 'This console is built around one rule: uncertainty should delay settlement, never accelerate it.',
  },
  {
    number: '02',
    eyebrow: 'Alice deposits',
    title: 'A request is not a balance',
    summary: 'Alice submits 1,000 USDC. The vault records intent, but issues no final shares.',
    note: 'Alice has created a claim on the system, not a finalized balance. The pending state is the protection.',
    audience: 'Point to Request REQ-0001 and its zero claimable amount.',
    truth: 'PENDING means claimableAmount is zero. No middleware approval has reached the vault.',
  },
  {
    number: '03',
    eyebrow: 'Prove the state',
    title: 'Validation earns claimability',
    summary: 'The middleware normalizes reference data, checks freshness, evaluates risk, and generates an attestation.',
    note: 'We are not treating external data as an oracle. It has to pass the full trust boundary before the vault can move.',
    audience: 'Run valid processing, then show the timeline moving from pending to claimable.',
    truth: 'Only a successful validation path changes the request to CLAIMABLE and sets a non-zero claimable amount.',
  },
  {
    number: '04',
    eyebrow: 'Alice claims',
    title: 'Settlement becomes final',
    summary: 'Alice claims the shares after the attestation is accepted. Premature minting never occurs.',
    note: 'The user can claim now because the protocol has evidence, not because a button was pressed.',
    audience: 'Click Claim Shares and point to the finalized request state.',
    truth: 'Claiming is one-way. A finalized request cannot return to pending or be claimed twice.',
  },
  {
    number: '05',
    eyebrow: 'Bob provides liquidity',
    title: 'T+0 without changing the RWA',
    summary: 'Alice sells a fixed-price claim for 980 USDC. Bob buys it and becomes the claim owner.',
    note: 'The claim market closes the liquidity gap. Alice exits early; Bob receives the future settlement right.',
    audience: 'Open the claim market and buy the listed Alice claim as Bob.',
    truth: 'The market transfers the claim, not the underlying asset. The settlement timetable stays intact.',
  },
  {
    number: '06',
    eyebrow: 'Fail safely',
    title: 'Delay is a successful outcome',
    summary: 'A new request meets stale or unverified data. Risk fails, attestation is rejected, and settlement stays blocked.',
    note: 'This is the safety demo. The protocol does not guess. It holds the request until the external state is trustworthy again.',
    audience: 'Create the failure case, run blocked validation, and show zero claimable value.',
    truth: 'External Reference Data is an input, never an official oracle. The vault remains pending when confidence drops.',
  },
];

function Demo() {
  const summary = useGetProtocolSummary({ query: { queryKey: getGetProtocolSummaryQueryKey(), refetchInterval: 12000 } });
  const requests = useListProtocolRequests({ query: { queryKey: getListProtocolRequestsQueryKey() } });
  const claims = useListProtocolClaims({ query: { queryKey: getListProtocolClaimsQueryKey() } });
  const create = useCreateProtocolRequest();
  const process = useProcessProtocolRequest();
  const claim = useClaimProtocolRequest();
  const buy = useBuyProtocolClaim();
  const setFailure = useSetProtocolFailureMode();
  const reset = useResetProtocolDemo();
  const qc = useQueryClient();
  const [activeStep, setActiveStep] = useState(0);
  const [failureRequestId, setFailureRequestId] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: getGetProtocolSummaryQueryKey() });
    qc.invalidateQueries({ queryKey: getListProtocolRequestsQueryKey() });
    qc.invalidateQueries({ queryKey: getListProtocolClaimsQueryKey() });
    qc.invalidateQueries({ queryKey: getListRwaAssetsQueryKey() });
  };
  const aliceRequest = requests.data?.find((request) => request.id === 'REQ-0001')
    || requests.data?.find((request) => request.owner.includes('Alice'));
  const aliceClaim = claims.data?.find((item) => item.id === 'CLM-0001')
    || claims.data?.find((item) => item.owner.includes('Alice'));
  const failureRequest = failureRequestId
    ? requests.data?.find((request) => request.id === failureRequestId)
    : undefined;
  const busy = create.isPending || process.isPending || claim.isPending || buy.isPending || setFailure.isPending;
  const completed = [
    true,
    Boolean(aliceRequest && aliceRequest.status !== 'PENDING'),
    Boolean(aliceRequest && aliceRequest.status === 'CLAIMABLE' || aliceRequest?.claimed),
    Boolean(aliceRequest?.claimed),
    Boolean(aliceClaim && (aliceClaim.status === 'SOLD' || aliceClaim.owner.includes('Bob'))),
    Boolean(failureRequest?.status === 'EXCEPTION'),
  ];
  const current = demoSteps[activeStep];

  const runReset = () => reset.mutate(undefined, {
    onSuccess: () => {
      setActiveStep(0);
      setFailureRequestId(null);
      setResetOpen(false);
      refresh();
    },
  });
  const processAlice = () => {
    if (!aliceRequest) return;
    process.mutate({ requestId: aliceRequest.id, data: { mode: 'valid' } }, {
      onSuccess: () => {
        refresh();
        setActiveStep(3);
      },
    });
  };
  const claimAlice = () => {
    if (!aliceRequest) return;
    claim.mutate({ requestId: aliceRequest.id }, {
      onSuccess: () => {
        refresh();
        setActiveStep(4);
      },
    });
  };
  const buyAliceClaim = () => {
    if (!aliceClaim) return;
    buy.mutate({ claimId: aliceClaim.id, data: { buyer: '0xBob...71C' } }, {
      onSuccess: () => {
        refresh();
        setActiveStep(5);
      },
    });
  };
  const startFailure = () => {
    if (failureRequestId) {
      process.mutate({ requestId: failureRequestId, data: { mode: 'valid' } }, { onSuccess: refresh });
      return;
    }
    create.mutate({ data: { kind: 'deposit', amount: 1000, owner: '0xAlice...9F2A' } }, {
      onSuccess: (request) => {
        setFailureRequestId(request.id);
        setFailure.mutate({ data: { enabled: true } }, { onSuccess: refresh });
      },
    });
  };
  const restoreSafeMode = () => setFailure.mutate({ data: { enabled: false } }, { onSuccess: refresh });

  return <>
    <PageHeader
      eyebrow="Conference demo · 5 minutes"
      title="Walk the room through it."
      description="A guided Alice/Bob runbook for proving asynchronous settlement, T+0 claim liquidity, and fail-closed middleware behavior."
      action={<Button variant="outline" onClick={() => setResetOpen(true)} data-testid="button-open-demo-reset"><RotateCcw size={14} /> Reset demo</Button>}
    />
    <section className="demo-intro">
      <div className="demo-intro-mark"><Play size={17} /></div>
      <div><b>Audience takeaway</b><span>ERC-7540 handles the asynchronous vault. Middleware handles asynchronous real-world state. The claim market handles the liquidity gap.</span></div>
      <StatusPill value={summary.data?.failureMode ? 'Settlement hold active' : 'Ready to present'} />
    </section>
    <div className="demo-layout">
      <aside className="demo-rail panel">
        <div className="demo-rail-head"><div><span className="eyebrow">Presenter runbook</span><b>{completed.filter(Boolean).length} / {demoSteps.length} checkpoints</b></div><BookOpen size={17} /></div>
        <div className="demo-progress"><span style={{ width: `${(completed.filter(Boolean).length / demoSteps.length) * 100}%` }} /></div>
        <div className="demo-step-list">
          {demoSteps.map((step, index) => <button key={step.number} className={`demo-step-item ${activeStep === index ? 'active' : ''} ${completed[index] ? 'complete' : ''}`} onClick={() => setActiveStep(index)} data-testid={`button-demo-step-${step.number}`}>
            <span className="demo-step-number">{completed[index] ? <Check size={12} /> : step.number}</span>
            <span><small>{step.eyebrow}</small><b>{step.title}</b></span>
            {activeStep === index && <ChevronRight size={14} />}
          </button>)}
        </div>
        <div className="demo-rail-foot"><span className="live-dot" /> State is connected to the live demo ledger</div>
      </aside>
      <main className="demo-main">
        <section className="panel demo-stage-card">
          <div className="demo-stage-head"><div><span className="eyebrow">Checkpoint {current.number} / {demoSteps.length}</span><h2>{current.title}</h2><p>{current.summary}</p></div><div className={`demo-stage-icon ${activeStep === 5 ? 'danger' : ''}`}>{activeStep === 0 ? <Play size={20} /> : activeStep === 4 ? <UserRound size={20} /> : activeStep === 5 ? <AlertTriangle size={20} /> : <CheckCircle2 size={20} />}</div></div>
          <div className="demo-stage-body">
            {activeStep === 0 && <div className="story-grid"><div className="story-box traditional"><span>Traditional vault</span><b>Deposit</b><ArrowRight size={15} /><b>Immediate shares</b></div><div className="story-box asynchronous"><span>Tokenized RWA</span><b>Deposit</b><ArrowRight size={15} /><b>T+2 / T+3 settlement</b></div></div>}
            {activeStep === 1 && <div className="demo-state-callout"><div className="state-callout-icon"><Clock3 size={19} /></div><div><span>Alice · 0xAlice...9F2A</span><b>{aliceRequest?.id || 'REQ-0001'} · {money(aliceRequest?.amount || 1000)} · {aliceRequest?.status || 'PENDING'}</b><small>Claimable shares: {money(aliceRequest?.claimableAmount || 0)}</small></div><StatusPill value={aliceRequest?.status || 'PENDING'} /></div>}
            {activeStep === 2 && <div className="demo-proof-chain"><div className="proof-line"><span className="proof-node done">1</span><b>External data received</b><small>Mock provider · labeled reference input</small></div><ArrowRight size={15} /><div className="proof-line"><span className="proof-node done">2</span><b>Validation + risk</b><small>Freshness, custody, NAV sanity</small></div><ArrowRight size={15} /><div className="proof-line"><span className="proof-node done">3</span><b>Attestation accepted</b><small>Request becomes claimable</small></div></div>}
            {activeStep === 3 && <div className="demo-state-callout settled"><div className="state-callout-icon"><BadgeCheck size={19} /></div><div><span>Alice · settlement proof accepted</span><b>{aliceRequest?.id || 'REQ-0001'} · Claimable shares ready</b><small>Claimable amount: {money(aliceRequest?.claimableAmount || 0)}</small></div><StatusPill value={aliceRequest?.status || 'CLAIMABLE'} /></div>}
            {activeStep === 4 && <div className="demo-transfer"><div className="transfer-party"><span className="party-avatar alice">A</span><div><small>Seller</small><b>Alice</b><span>T+0 liquidity</span></div></div><ArrowRight size={18} /><div className="transfer-asset"><span>CLAIM</span><b>$1,000 → $980</b><small>2% fixed-price discount · T+2 settlement</small></div><ArrowRight size={18} /><div className="transfer-party"><span className="party-avatar bob">B</span><div><small>Buyer</small><b>Bob</b><span>Future claim owner</span></div></div></div>}
            {activeStep === 5 && <div className={`demo-failure-state ${failureRequest?.status === 'EXCEPTION' ? 'blocked' : ''}`}><div className="failure-orbit"><AlertTriangle size={20} /></div><div><span>{failureRequest?.id || 'New request'} · External data check</span><b>{failureRequest?.status === 'EXCEPTION' ? 'Settlement blocked' : summary.data?.failureMode ? 'Validation hold active' : 'Ready to simulate failure'}</b><small>{failureRequest?.status === 'EXCEPTION' ? 'Attestation rejected. Claimable value remains $0.00.' : 'Create a fresh Alice request, then run it against stale or unverified reference data.'}</small></div><StatusPill value={failureRequest?.status === 'EXCEPTION' ? 'EXCEPTION' : summary.data?.failureMode ? 'HOLD' : 'READY'} /></div>}
          </div>
          <div className="demo-stage-actions">
            <div className="demo-action-explain">{activeStep === 0 ? <><b>Start with the problem.</b><span>No state change yet. Set up the temporal mismatch.</span></> : activeStep === 1 ? <><b>Show the pending invariant.</b><span>Before settlement, the request cannot create final shares.</span></> : activeStep === 2 ? <><b>Let proof move the state.</b><span>Only a valid middleware path can make the request claimable.</span></> : activeStep === 3 ? <><b>Finalize Alice's position.</b><span>Claiming is available only after the attestation.</span></> : activeStep === 4 ? <><b>Close the liquidity gap.</b><span>Buy the seeded Alice claim as Bob for T+0 liquidity.</span></> : <><b>Make the safety rule memorable.</b><span>When data is uncertain, the protocol delays settlement.</span></>}</div>
            <div className="demo-action-buttons">
              {activeStep === 0 && <Button onClick={() => setActiveStep(1)} data-testid="button-demo-start">Show Alice's request <ArrowRight size={14} /></Button>}
              {activeStep === 1 && <Button onClick={processAlice} disabled={busy || !aliceRequest || aliceRequest.status !== 'PENDING'} data-testid="button-demo-process-alice">{process.isPending ? 'Processing…' : 'Run valid settlement'}</Button>}
              {activeStep === 2 && <Button onClick={() => setActiveStep(3)} data-testid="button-demo-show-claim">Show claimable state <ArrowRight size={14} /></Button>}
              {activeStep === 3 && <Button onClick={claimAlice} disabled={busy || !aliceRequest || aliceRequest.claimableAmount <= 0 || aliceRequest.claimed} data-testid="button-demo-claim-alice">{claim.isPending ? 'Claiming…' : aliceRequest?.claimed ? 'Shares claimed' : 'Claim Alice’s shares'}</Button>}
              {activeStep === 4 && <Button onClick={buyAliceClaim} disabled={busy || !aliceClaim || aliceClaim.status !== 'LISTED'} data-testid="button-demo-buy-bob">{buy.isPending ? 'Buying…' : aliceClaim?.status === 'SOLD' ? 'Claim owned by Bob' : 'Buy as Bob · $980'}</Button>}
              {activeStep === 5 && <>{failureRequest?.status === 'EXCEPTION' ? <Button variant="outline" onClick={restoreSafeMode} disabled={setFailure.isPending} data-testid="button-demo-restore-safe">{setFailure.isPending ? 'Restoring…' : 'Restore safe mode'}</Button> : <Button variant="destructive" onClick={startFailure} disabled={busy} data-testid="button-demo-trigger-failure">{busy ? 'Running failure path…' : failureRequestId ? 'Run blocked validation' : 'Create failure case'}</Button>}</>}
              {activeStep < demoSteps.length - 1 && <Button variant="ghost" onClick={() => setActiveStep((step) => Math.min(demoSteps.length - 1, step + 1))} disabled={busy}>Next checkpoint <ArrowRight size={14} /></Button>}
            </div>
          </div>
        </section>
        <section className="panel presenter-notes">
          <div className="section-title"><div className="title-left"><Copy size={16} /><h2>Presenter notes</h2><span>Say this out loud</span></div><span className="notes-cue"><span className="live-dot" /> Live cue</span></div>
          <div className="notes-grid"><div className="quote-note"><span className="note-label">Suggested line</span><p>“{current.note}”</p></div><div className="notes-detail"><div><span className="note-label">Audience should see</span><b>{current.audience}</b></div><div><span className="note-label">Protocol truth</span><b>{current.truth}</b></div></div></div>
        </section>
      </main>
    </div>
    {resetOpen && <div className="reset-scrim" role="presentation" onClick={() => setResetOpen(false)}><div className="reset-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-demo-title" onClick={(event) => event.stopPropagation()}><div className="reset-dialog-icon"><RotateCcw size={19} /></div><span className="eyebrow">Conference controls</span><h2 id="reset-demo-title">Reset the demo run?</h2><p>This returns Alice’s pending request, the claim market listing, and all middleware controls to the opening state. It is safe to use between presenters.</p><div className="reset-dialog-actions"><Button variant="ghost" onClick={() => setResetOpen(false)}>Keep current state</Button><Button onClick={runReset} disabled={reset.isPending}>{reset.isPending ? 'Resetting…' : 'Reset and start over'}</Button></div></div></div>}
  </>;
}

function RequestTimeline({ row, onProcess, onClaim, processing, claiming }: { row: ProtocolRequest; onProcess: () => void; onClaim: () => void; processing: boolean; claiming: boolean }) {
  return <article className="panel timeline-card"><div className="timeline-head"><div className="request-id"><span className={`kind-marker ${row.kind === 'deposit' ? 'deposit' : 'redeem'}`}>{row.kind === 'deposit' ? 'D' : 'R'}</span><div><b>{row.id}</b><small>{row.kind} · {row.owner} · {shortDate(row.createdAt)}</small></div></div><StatusPill value={row.status} /></div><div className="timeline-steps">{row.steps.map((step, i) => <div className="timeline-step" key={`${row.id}-${step.label}`}><div className={`timeline-dot ${tone(step.state)}`}>{tone(step.state) === 'good' ? <Check size={12} /> : i + 1}</div><div className="timeline-step-copy"><b>{step.label}</b><span>{step.detail || step.state}</span></div>{i < row.steps.length - 1 && <div className="timeline-connector" />}</div>)}</div><div className="timeline-foot"><span className="message"><Info size={14} /> {row.message}</span><div className="timeline-actions"><a className="inline-link text-xs" href="https://sepolia.basescan.org" target="_blank" rel="noreferrer">Basescan <ArrowUpRight size={11} /></a>{(row.status.toLowerCase().includes('pending') || row.status.toLowerCase().includes('queued')) && <Button variant="outline" size="sm" disabled={processing} onClick={onProcess} data-testid={`button-process-timeline-${row.id}`}>{processing ? 'Processing…' : 'Run validation'}</Button>}{row.claimableAmount > 0 && !row.claimed && <Button size="sm" disabled={claiming} onClick={onClaim} data-testid={`button-claim-${row.id}`}>{claiming ? 'Claiming…' : `Claim ${money(row.claimableAmount)}`}</Button>}{row.claimed && <span className="claimed-label"><Check size={14} /> Claimed</span>}</div></div></article>;
}

function Claims() {
  const { data, isLoading, isError } = useListProtocolClaims({ query: { queryKey: getListProtocolClaimsQueryKey() } });
  const list = useListProtocolClaim(); const buy = useBuyProtocolClaim(); const qc = useQueryClient();
  const [buyer, setBuyer] = useState('treasury@northstar.capital');
  const claims = Array.isArray(data) ? data : [];
  const onList = (claim: ProtocolClaim) => list.mutate({ claimId: claim.id, data: { price: Math.max(1, claim.price || claim.faceValue * 0.98) } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListProtocolClaimsQueryKey() }) });
  const onBuy = (claim: ProtocolClaim) => buy.mutate({ claimId: claim.id, data: { buyer } }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListProtocolClaimsQueryKey() }) });
  return <><PageHeader eyebrow="Liquidity bridge" title="Fixed-price claim market." description="Bridge T+0 liquidity without repricing the underlying asset. Claims are listed at a known price against a settled request." action={<label className="buyer-input">Buyer account<Input value={buyer} onChange={e => setBuyer(e.target.value)} data-testid="input-buyer" /></label>} /><div className="liquidity-note"><Zap size={17} /><div><b>Why fixed-price claims?</b><span>A claim can move liquidity today while the underlying RWA follows its own settlement timetable. Price certainty is the bridge.</span></div><StatusPill value="T+0 liquidity" /></div><section className="panel claims-panel"><SectionTitle icon={ArrowUpRight} title="Market inventory" meta={`${claims.length} claims`} />{isLoading ? <div className="claims-grid">{Array.from({ length: 3 }).map((_, i) => <Skeleton className="claim-card" key={i} />)}</div> : isError ? <ErrorState /> : claims.length === 0 ? <div className="empty-state"><WalletCards size={24} /><strong>No claims available</strong><span>Process a claimable deposit, then list it here at a fixed price.</span><Link href="/requests" className="inline-link">Go to request processing <ArrowUpRight size={13} /></Link></div> : <div className="claims-grid">{claims.map(claim => <article className="claim-card" key={claim.id} data-testid={`card-claim-${claim.id}`}><div className="claim-top"><span className="claim-token">CLAIM #{claim.id}</span><StatusPill value={claim.status} /></div><div className="claim-title"><h3>{money(claim.faceValue)}</h3><span>face value</span></div><div className="claim-price"><div><span>Fixed price</span><b>{money(claim.price)}</b></div><div className="discount"><span>Discount</span><b>{pct(claim.discount)}</b></div></div><div className="claim-detail"><span>Seller <b className="mono">{claim.owner}</b></span><span>Request <b>{claim.requestId}</b></span><span>Asset <b>{claim.assetId}</b></span><span>Settlement <StatusPill value={claim.settlement || 'T+2'} dot={false} /></span></div><div className="claim-actions">{claim.status.toLowerCase().includes('listed') ? <Button className="flex-1" disabled={buy.isPending || !buyer} onClick={() => onBuy(claim)} data-testid={`button-buy-claim-${claim.id}`}>{buy.isPending ? 'Buying…' : 'Buy claim'} <ArrowUpRight size={14} /></Button> : <Button variant="outline" className="flex-1" disabled={list.isPending} onClick={() => onList(claim)} data-testid={`button-list-claim-${claim.id}`}>{list.isPending ? 'Listing…' : 'List at fixed price'}</Button>}</div></article>)}</div>}</section></>;
}

function Monitor() {
  const { data, isLoading, isError } = useGetProtocolSummary({ query: { queryKey: getGetProtocolSummaryQueryKey(), refetchInterval: 12000 } });
  const setFailure = useSetProtocolFailureMode(); const reset = useResetProtocolDemo(); const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: getGetProtocolSummaryQueryKey() }); qc.invalidateQueries({ queryKey: getListProtocolRequestsQueryKey() }); qc.invalidateQueries({ queryKey: getListProtocolClaimsQueryKey() }); qc.invalidateQueries({ queryKey: getListRwaAssetsQueryKey() }); };
  if (isLoading) return <><PageHeader eyebrow="Middleware & controls" title="Make uncertainty explicit." description="Controls for external reference data, middleware policy and conference demo state." /><div className="control-grid">{Array.from({ length: 4 }).map((_, i) => <Skeleton className="control-card" key={i} />)}</div></>;
  if (isError || !data) return <ErrorState />;
  return <><PageHeader eyebrow="Middleware & controls" title="Make uncertainty explicit." description="Controls for external reference data, middleware policy and conference demo state." action={<StatusPill value={data.failureMode ? 'Failure mode active' : 'All systems nominal'} />} /><div className="control-grid"><ControlCard icon={Database} label="External Reference Data" status={data.firecrawlStatus} copy="Firecrawl and mock-provider values are visible inputs, never invisible assumptions." /><ControlCard icon={ServerCog} label="Middleware validation" status={data.middlewareStatus} copy="Normalize, validate, check freshness and apply conservative risk policy before attestation." /><ControlCard icon={ShieldCheck} label="Oracle health" status={data.oracleStatus} copy="NAV and yield values are held when source freshness or schema confidence drops." /><ControlCard icon={LockKeyhole} label="Failure policy" status={data.failureMode ? 'Hold settlement' : 'Fail closed'} copy="The protocol delays settlement rather than accepting uncertain external data." /></div><section className="panel controls-panel"><SectionTitle icon={SlidersHorizontal} title="Conference controls" meta="Simulate the safe path" /><div className="control-row"><div className="control-copy"><b>Invalid external data simulation</b><span>Force the next middleware run to reject its reference payload. This demonstrates why the request remains non-claimable.</span></div><Button variant={data.failureMode ? 'destructive' : 'outline'} disabled={setFailure.isPending} onClick={() => setFailure.mutate({ data: { enabled: !data.failureMode } }, { onSuccess: refresh })} data-testid="button-toggle-failure">{setFailure.isPending ? 'Applying…' : data.failureMode ? 'Disable failure mode' : 'Enable failure mode'}</Button></div><div className="control-row reset-row"><div className="control-copy"><b>Reset demo state</b><span>Return the protocol to its opening conference state and clear the synthetic request flow.</span></div><Button variant="outline" disabled={reset.isPending} onClick={() => reset.mutate(undefined, { onSuccess: refresh })} data-testid="button-reset-demo"><RefreshCw size={14} />{reset.isPending ? 'Resetting…' : 'Reset conference demo'}</Button></div>{(setFailure.isError || reset.isError) && <div className="form-error">Control change failed. Keep settlement on hold and retry.</div>}</section><section className="panel decision-panel"><SectionTitle icon={CircleAlert} title="Operator decision rule" meta="Always visible" /><div className="decision"><div className="decision-mark">!</div><div><h3>WHEN DATA IS UNCERTAIN, DELAY SETTLEMENT.</h3><p>Never settle on uncertain data. Uncertain data → remain pending. The queue is an intentional buffer for uncertainty, not a failure of the system.</p></div></div></section></>;
}

function ControlCard({ icon: Icon, label, status, copy }: { icon: typeof Database; label: string; status?: string; copy: string }) {
  return <article className="panel control-card"><div className="control-icon"><Icon size={18} /></div><div className="control-card-head"><h3>{label}</h3><StatusPill value={status} /></div><p>{copy}</p><div className="control-rule" /></article>;
}

function RoutePage() {
  return <Switch><Route path="/" component={Home} /><Route path="/demo" component={Demo} /><Route path="/vault" component={Vault} /><Route path="/assets" component={Assets} /><Route path="/requests" component={Requests} /><Route path="/claims" component={Claims} /><Route path="/monitor" component={Monitor} /><Route component={NotFound} /></Switch>;
}

function NotFound() {
  return <div className="not-found"><div className="eyebrow">404 / route absent</div><h1>This control surface does not exist.</h1><p>Return to the protocol overview to continue operating safely.</p><Link href="/" className="inline-link">Back to overview <ArrowUpRight size={13} /></Link></div>;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><RoutedErrorBoundary><Shell><RoutePage /></Shell></RoutedErrorBoundary></WouterRouter><Toaster /></QueryClientProvider>;
}

export default App;