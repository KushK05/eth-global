"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type EventItem = { id: string; title: string; detail: string; time: string; status: string; chain: string; txId?: string };
type Agent = { name: string; role: string; identity: string; allocation: string; spent: string; reserved: string; limit: string; merchant: string; color: string };
type Offer = { lender: string; aprBps: number; apr: string; available: string; selected: boolean; score: string };
type Integration = { label: string; mode: string; ready: boolean; detail: string };
type IntegrationStatus = Record<"x402" | "ats" | "aqua" | "adk", Integration>;
type DemoState = {
  id: string;
  stage: string;
  mode: string;
  invoice: { buyer: string; operator: string; faceValue: string; currency: string; terms: string; advanceRateBps: number; status: string; receivableId: string; tokenId: string; dueDate: string; verification: string };
  facility: { status: string; borrowingBase: string; funded: string; outstanding: string; spent: string; reserved: string; remaining: string; feeTotal: string; operatorRemainder: string; repaymentAmount: string; chain: string };
  offers: Offer[];
  allocations: { lender: string; principal: string; aprBps: number; fee: string; repayment: string }[];
  agents: Agent[];
  events: EventItem[];
  spends: { id: string; agent: string; merchant: string; amount: string; status: string; txId: string; network: string; createdAt: string }[];
};

const API = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
const fmt = (value: string | number) => Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const remaining = (agent: Agent) => Math.max(0, Number(agent.allocation) - Number(agent.spent) - Number(agent.reserved));

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/></>,
    layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 17l9 5 9-5"/></>,
    pulse: <><path d="M3 12h4l3-8 4 16 3-8h4"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.3a1.7 1.7 0 0 1-3.4 0v-.2A1.7 1.7 0 0 0 7.8 17l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9H4a1.7 1.7 0 0 1 0-3.4h.2A1.7 1.7 0 0 0 5.4 5.8l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2V2a1.7 1.7 0 0 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.3a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.3 2.9Z"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 6l2 6M4 12l2 6a7 7 0 0 0 12.4-3"/></>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></>,
    external: <><path d="M15 3h6v6M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></>,
    warning: <><path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.grid}</svg>;
}

function StageRail({ stage }: { stage: string }) {
  const stages = ["Verify", "Fund", "Spend", "Repay"];
  const current = { verify: 0, fund: 1, spend: 2, repay: 3 }[stage] ?? 0;
  return <section className="rail" aria-label="Credit lifecycle">
    <div className="rail-line"><span style={{ width: `${(current / (stages.length - 1)) * 100}%` }} /></div>
    {stages.map((item, index) => <div className={`rail-stage ${index < current ? "complete" : ""} ${index === current ? "current" : ""}`} key={item}>
      <span className="stage-dot">{index < current ? <Icon name="check" size={13} /> : `0${index + 1}`}</span>
      <span className="stage-name">{item}</span>
      <span className="stage-detail">{["Buyer confirmed", "Lender matched", "Agent controls", "Debt cleared"][index]}</span>
    </div>)}
  </section>;
}

function Amount({ children, large = false }: { children: React.ReactNode; large?: boolean }) {
  return <span className={`amount ${large ? "amount-large" : ""}`}><span className="currency">$</span>{children}</span>;
}

export default function Dashboard() {
  const [demo, setDemo] = useState<DemoState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<EventItem | null>(null);
  const [apiError, setApiError] = useState("");
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(null);

  const load = useCallback(async () => {
    try {
      const [demoResponse, integrationResponse] = await Promise.all([
        fetch(`${API}/api/demo/retailco-net30`, { cache: "no-store" }),
        fetch(`${API}/api/integrations`, { cache: "no-store" }),
      ]);
      if (!demoResponse.ok) throw new Error(`API responded ${demoResponse.status}`);
      setDemo(await demoResponse.json());
      if (integrationResponse.ok) setIntegrations(await integrationResponse.json());
      setApiError("");
    } catch {
      setApiError("The demo API is unavailable. Start the orchestrator on port 8000, then retry.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (action: string, label: string) => {
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch(`${API}/api/demo/retailco-net30/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ action }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail ?? `Unable to ${label.toLowerCase()}.`);
      setDemo(result.state);
      setMessage(result.event);
    } catch (error) {
      setMessage({ id: crypto.randomUUID(), title: `${label} failed`, detail: error instanceof Error ? error.message : "Please retry.", time: "Just now", status: "danger", chain: "Local demo" });
    } finally {
      setBusy(null);
    }
  };

  const reset = async () => {
    setBusy("reset");
    try {
      const response = await fetch(`${API}/api/demo/retailco-net30/reset`, { method: "POST" });
      if (!response.ok) throw new Error("Unable to reset the demo.");
      setDemo(await response.json());
      setMessage(null);
    } catch (error) {
      setApiError(error instanceof Error ? error.message : "Unable to reset the demo.");
    } finally { setBusy(null); }
  };

  const maxBudget = useMemo(() => demo?.agents.reduce((sum, agent) => sum + Number(agent.allocation), 0) ?? 0, [demo]);
  if (!demo) return <main className="loading-screen"><div className="loading-mark">WC</div><p>{apiError || "Connecting to working capital desk…"}</p>{apiError && <button className="button secondary" onClick={() => void load()}>Retry connection</button>}</main>;

  const currentIndex = { verify: 0, fund: 1, spend: 2, repay: 3 }[demo.stage] ?? 0;
  const primary = currentIndex === 0 ? ["confirm_invoice", "Prepare tokenization (simulated)"] : currentIndex === 1 ? ["match_lenders", "Match lender capital"] : currentIndex === 2 ? ["research_payment", "Run research agent · $0.25"] : ["confirm_invoice", "Facility complete"];
  const primaryDisabled = currentIndex > 2;
  const settledDebt = Number(demo.facility.outstanding) === 0 && demo.stage === "repay";
  const lenderDue = Number(demo.facility.funded) + Number(demo.facility.feeTotal);
  const operatorShare = Math.max(0, Number(demo.facility.repaymentAmount) - lenderDue);
  const debtDue = settledDebt ? 0 : Number(demo.facility.outstanding) + Number(demo.facility.feeTotal);
  const readyIntegrations = integrations ? Object.values(integrations).filter((integration) => integration.ready).length : 0;
  const paymentIsLive = integrations?.x402.ready ?? false;

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#overview" aria-label="Working Capital Desk home"><span className="brand-mark">w</span><span className="brand-copy">working capital<span>DESK</span></span></a>
      <div className="workspace-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="Main navigation">
        <a className="nav-item active" href="#overview"><Icon name="grid" /><span>Overview</span></a>
        <a className="nav-item" href="#receivable"><Icon name="file" /><span>Receivables</span><span className="nav-count">1</span></a>
        <a className="nav-item" href="#funding"><Icon name="layers" /><span>Credit facilities</span></a>
        <a className="nav-item" href="#activity"><Icon name="pulse" /><span>Activity</span></a>
      </nav>
      <div className="side-bottom">
        <div className="security-note"><span className="security-icon"><Icon name="shield" size={16} /></span><span><b>Policy engine active</b><small>Credit rules enforced</small></span><i className="green-dot" /></div>
        <div className="nav-item settings-button"><Icon name="settings" /><span>Settings</span></div>
        <div className="profile"><span className="avatar">NS</span><span className="profile-name"><b>Northstar Agents</b><small>Operator account</small></span><span className="profile-menu">···</span></div>
      </div>
    </aside>

    <main className="main-content" id="overview">
      <header className="topbar">
        <div className="breadcrumbs"><span>Workspace</span><b>/</b><strong>Overview</strong></div>
        <div className="top-actions"><span className={`network-pill ${paymentIsLive ? "live" : ""}`}><i /> {paymentIsLive ? "Hedera testnet ready" : "Local demo mode"}</span><button className="icon-button" aria-label="Refresh demo state" onClick={() => void load()}><Icon name="refresh" size={17} /></button><span className="top-avatar">NS</span></div>
      </header>
      <div className="page-wrap">
        <section className="page-heading">
          <div><p className="eyebrow">MONDAY, OCTOBER 20, 2026 <span className="eyebrow-divider" /> RETAILCO · NET 30</p><h1>Good morning, Northstar</h1><p className="subheading">Your receivable is verified. Put future revenue to work.</p></div>
          <button className="button quiet reset-button" onClick={reset} disabled={busy !== null}><Icon name="refresh" size={16} /> Reset demo</button>
        </section>

        <StageRail stage={demo.stage} />

        <section className="integration-board" aria-label="Integration readiness">
          <div className="integration-heading"><div><h2>Execution readiness</h2><p>Every chain action stays blocked until its own proof path is configured.</p></div><span className="readiness-count">{readyIntegrations} of 4 configured</span></div>
          <div className="integration-list">{integrations ? Object.entries(integrations).map(([key, integration]) => <article className={`integration-item ${integration.ready ? "ready" : "waiting"}`} key={key}><span className="integration-glyph">{key === "x402" ? "$" : key === "ats" ? "H" : key === "aqua" ? "A" : "G"}</span><div><div className="integration-title"><strong>{integration.label}</strong><span>{integration.ready ? "Ready" : integration.mode.replaceAll("-", " ")}</span></div><p>{integration.detail}</p></div><i className={integration.ready ? "green-dot" : "amber-dot"} /></article>) : <p className="integration-loading">Checking configured integrations…</p>}</div>
        </section>

        {apiError && <div className="inline-alert danger-alert" role="alert"><Icon name="warning" /><span>{apiError}</span><button onClick={() => void load()}>Retry</button></div>}
        {message && <div className={`inline-alert ${message.status === "danger" ? "danger-alert" : "success-alert"}`} role="status"><span className="alert-icon"><Icon name={message.status === "danger" ? "warning" : "check"} size={17} /></span><div><strong>{message.title}</strong><p>{message.detail}</p></div><button className="alert-close" aria-label="Dismiss message" onClick={() => setMessage(null)}>×</button></div>}

        <section className="metric-grid" aria-label="Facility summary">
          <article className="metric-card featured-metric"><div className="metric-top"><span>Available credit</span><span className="metric-icon blue-icon"><Icon name="layers" size={17} /></span></div><div className="metric-value"><Amount large>{fmt(demo.facility.remaining)}</Amount><span className="metric-unit">USDC</span></div><div className="metric-foot"><span className="metric-status"><i className={demo.stage === "spend" ? "green-dot" : "blue-dot"} />{demo.facility.status.replaceAll("_", " ").toLowerCase()}</span><span className="metric-caption">of <Amount>{fmt(demo.facility.borrowingBase)}</Amount> borrowing base</span></div><div className="metric-meter"><span style={{ width: `${demo.facility.funded === "0.00" ? 0 : (Number(demo.facility.remaining) / Number(demo.facility.funded)) * 100}%` }} /></div></article>
          <article className="metric-card"><div className="metric-top"><span>Invoice value</span><span className="metric-icon"><Icon name="file" size={17} /></span></div><div className="metric-value"><Amount large>{fmt(demo.invoice.faceValue)}</Amount><span className="metric-unit">USDC</span></div><div className="metric-foot"><span className="tag verified"><Icon name="check" size={12} /> Buyer verified</span><span className="metric-caption">Due {new Date(`${demo.invoice.dueDate}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></div></article>
          <article className="metric-card"><div className="metric-top"><span>Outstanding debt</span><span className="metric-icon"><Icon name="pulse" size={17} /></span></div><div className="metric-value"><Amount large>{fmt(debtDue)}</Amount><span className="metric-unit">USDC</span></div><div className="metric-foot"><span className={`metric-status ${settledDebt ? "positive" : ""}`}><i className={settledDebt ? "green-dot" : "amber-dot"} />{settledDebt ? "Repaid in full" : "Principal + accrued fee"}</span><span className="metric-caption">{demo.allocations.length || 0} lenders</span></div></article>
          <article className="metric-card"><div className="metric-top"><span>Agent spend</span><span className="metric-icon"><Icon name="pulse" size={17} /></span></div><div className="metric-value"><Amount large>{fmt(demo.facility.spent)}</Amount><span className="metric-unit">USDC</span></div><div className="metric-foot"><span className="metric-status"><i className="blue-dot" />Across 3 agents</span><span className="metric-caption">of <Amount>{fmt(maxBudget)}</Amount> allocated</span></div></article>
        </section>

        <div className="content-grid">
          <div className="primary-column">
            <section className="panel receivable-panel" id="receivable">
              <div className="panel-heading"><div><div className="panel-title-row"><span className="section-icon invoice-icon"><Icon name="file" size={16} /></span><h2>Verified receivable</h2><span className="tag verified"><Icon name="check" size={12} /> Buyer verified</span>{demo.invoice.tokenId.includes("Pending") && <span className="tag pending">ATS pending</span>}{demo.invoice.tokenId.includes("Simulated") && <span className="tag pending">Simulation only</span>}</div><p className="panel-subtitle">One accepted invoice backs this shared credit line.</p></div><span className="more-button" aria-hidden="true">···</span></div>
              <div className="invoice-summary"><div className="buyer-mark">R</div><div className="buyer-details"><strong>RetailCo</strong><span>Invoice INV-2048 · {demo.invoice.terms}</span></div><div className="invoice-total"><Amount>{fmt(demo.invoice.faceValue)}</Amount><span>Face value</span></div></div>
              <div className="invoice-facts"><div><span>Operator</span><strong>{demo.invoice.operator}</strong></div><div><span>Advance rate</span><strong>{(demo.invoice.advanceRateBps / 100).toFixed(0)}%</strong></div><div><span>Borrowing base</span><strong><Amount>{fmt(demo.facility.borrowingBase)}</Amount></strong></div><div><span>Due date</span><strong>{new Date(`${demo.invoice.dueDate}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</strong></div></div>
              <div className="receivable-foot"><span className="chain-label"><span className="hedera-symbol">H</span> Hedera <span className="bullet">·</span> Asset Tokenization Studio</span><span className="id-label">ID <code>{demo.invoice.receivableId}</code><button className="copy-button" aria-label="Copy receivable ID" onClick={() => void navigator.clipboard?.writeText(demo.invoice.receivableId)}>Copy</button></span></div>
            </section>

            <section className="panel funding-panel" id="funding">
              <div className="panel-heading"><div><div className="panel-title-row"><span className="section-icon funding-icon"><Icon name="layers" size={16} /></span><h2>Lender matching</h2><span className="small-note">{demo.allocations.length ? `${demo.allocations.length} matched` : "3 offers"}</span></div><p className="panel-subtitle">Cheapest eligible capital funds first.</p></div><span className="aqua-mark">1inch <b>Aqua</b></span></div>
              <div className="table-wrap"><table><thead><tr><th>Lender</th><th>Risk tier</th><th>Available</th><th>APR</th><th>Decision</th></tr></thead><tbody>{demo.offers.map(offer => <tr key={offer.lender} className={offer.selected ? "selected-row" : ""}><td><span className={`lender-avatar ${offer.lender.toLowerCase()}`}>{offer.lender[0]}</span><strong>{offer.lender}</strong></td><td><span className={`risk-tier ${offer.score === "B" ? "tier-b" : ""}`}>{offer.score}</span></td><td><Amount>{fmt(offer.available)}</Amount></td><td className="apr-cell">{offer.apr}</td><td>{offer.selected ? <span className="tag selected"><Icon name="check" size={12} /> Matched</span> : offer.lender === "Charlie" && demo.allocations.length ? <span className="tag not-needed">Not needed</span> : <span className="offer-ready">Eligible</span>}</td></tr>)}</tbody></table></div>
              <div className="funding-foot"><span><Icon name="shield" size={14} /> Buyer score meets lender rules</span><span>Instruction <code>RECEIVABLE_CREDIT_V1</code></span></div>
            </section>

            <section className="panel agents-panel">
              <div className="panel-heading"><div><div className="panel-title-row"><span className="section-icon agents-icon"><Icon name="grid" size={16} /></span><h2>Shared agent budgets</h2></div><p className="panel-subtitle">One facility ceiling, with spend reserved by agent.</p></div><span className="agent-count">{demo.agents.length - 1} agents <span className="green-dot" /></span></div>
              <div className="agent-list">{demo.agents.filter(agent => agent.name !== "Reserve").map(agent => <article className="agent-row" key={agent.name}><span className={`agent-avatar ${agent.color}`}>{agent.name === "Research" ? "R" : agent.name === "Compute" ? "C" : "D"}</span><div className="agent-ident"><strong>{agent.name}</strong><span>{agent.role}</span></div><div className="agent-budget"><span><Amount>{fmt(agent.spent)}</Amount> <i>/</i> <Amount>{fmt(agent.allocation)}</Amount></span><div className="budget-track"><span className={agent.color} style={{ width: `${Math.min(100, Number(agent.spent) / Number(agent.allocation) * 100)}%` }} /></div></div><div className="agent-limit"><span>Per transaction</span><strong>{agent.limit === "-" ? "-" : <Amount>{fmt(agent.limit)}</Amount>}</strong></div><span className="agent-state"><i className="green-dot" /> Active</span></article>)}</div>
              <div className="agent-foot"><span><Icon name="shield" size={14} /> Merchant allowlist and limits enforced</span><span>HCS-14 identities</span></div>
            </section>
          </div>

          <aside className="secondary-column">
            <section className="panel action-panel">
              <div className="action-overline"><span className="live-indicator"><i /> Workflow controls</span><span className={`simulated-label ${paymentIsLive ? "live-label" : ""}`}>{paymentIsLive ? "TESTNET" : "SIMULATED"}</span></div>
              <h2>Move the workflow</h2><p className="action-description">Run each step to see how verified revenue becomes controlled agent spend.</p>
              <button className="button primary action-primary" disabled={primaryDisabled || busy !== null} onClick={() => void run(primary[0], primary[1])}>{busy === primary[0] ? <span className="spinner" /> : <Icon name={currentIndex === 2 ? "pulse" : "arrow"} size={16} />}{primary[1]}</button>
              <div className="action-divider"><span>POLICY TESTS</span></div>
              <button className="button policy-button" disabled={currentIndex !== 2 || busy !== null} onClick={() => void run("compute_overspend", "Compute overspend") }><span className="policy-icon"><Icon name="warning" size={16} /></span><span><b>Attempt overspend</b><small>Compute requests $5,500</small></span><Icon name="arrow" size={15} /></button>
              <button className="button policy-button" disabled={currentIndex !== 2 || busy !== null} onClick={() => void run("global_overspend", "Global credit limit") }><span className="policy-icon"><Icon name="shield" size={16} /></span><span><b>Test facility ceiling</b><small>Separate global limit check</small></span><Icon name="arrow" size={15} /></button>
              <button className="button repay-button" disabled={currentIndex !== 2 || busy !== null} onClick={() => void run("repay", "Repay facility")}>{busy === "repay" ? <span className="spinner" /> : <Icon name="check" size={16} />}Customer paid · repay lenders</button>
              <div className="action-trust"><Icon name="shield" size={15} /><span>Credit decisions are deterministic. The demo coordinator is a prototype trust assumption.</span></div>
            </section>

            <section className="panel waterfall-panel">
              <div className="panel-heading compact-heading"><div><div className="panel-title-row"><span className="section-icon repay-icon"><Icon name="arrow" size={15} /></span><h2>Repayment waterfall</h2></div><p className="panel-subtitle">Lenders are paid before the operator.</p></div></div>
              <div className="waterfall-source"><span className="customer-mark">R</span><span><b>RetailCo</b><small>Customer payment</small></span><Amount>{fmt(demo.facility.repaymentAmount)}</Amount></div>
              <div className="waterfall-connector"><i /></div>
              <div className="waterfall-destinations"><div className="waterfall-row"><span className="waterfall-dot lender-dot" /><span><b>Lenders</b><small>Principal + accrued fee</small></span><Amount>{fmt(lenderDue)}</Amount></div><div className="waterfall-row"><span className="waterfall-dot operator-dot" /><span><b>Operator</b><small>Remaining proceeds</small></span><Amount>{fmt(demo.stage === "repay" ? demo.facility.operatorRemainder : operatorShare)}</Amount></div></div>
              <div className={`waterfall-status ${settledDebt ? "paid" : ""}`}><Icon name={settledDebt ? "check" : "clock"} size={14} />{settledDebt ? "All obligations settled" : "Awaiting customer payment"}</div>
            </section>

            <section className="panel activity-panel" id="activity">
              <div className="panel-heading compact-heading"><div><div className="panel-title-row"><span className="section-icon activity-icon"><Icon name="pulse" size={16} /></span><h2>Recent activity</h2></div></div><a className="text-link" href="#activity">View all</a></div>
              <div className="activity-list">{demo.events.slice(0, 5).map((event, index) => <article className="activity-row" key={event.id}><span className={`activity-pin ${event.status}`}><Icon name={event.status === "danger" ? "warning" : event.status === "success" ? "check" : "clock"} size={12} /></span><div className="activity-copy"><strong>{event.title}</strong><p>{event.detail}</p><span className="activity-meta">{event.chain} <i>·</i> {index === 0 ? "Just now" : event.time}</span></div></article>)}</div>
            </section>
          </aside>
        </div>
        <footer className="page-footer"><span>Working Capital Desk <i>·</i> Prototype v0.1</span><span>{paymentIsLive ? "Live spends require a finalized Hedera receipt." : "Network actions remain simulated until their adapters are configured."}</span></footer>
      </div>
    </main>
  </div>;
}
