"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  CalendarDays,
  Check,
  ClipboardList,
  Download,
  PackagePlus,
  RotateCcw,
  ShoppingBasket,
  Trash2,
} from "lucide-react";
import type { Invoice, OperationsRecord, Product } from "@/lib/db";
import { csvCell, formatMoney } from "@/lib/format";

type PlanLine = {
  id: string;
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  unitCost: number;
  supplier: string;
  ordered: boolean;
};

type ArchivedRound = {
  id: string;
  date: string;
  archivedAt: number;
  lines: PlanLine[];
};

type WorkbenchState = {
  targetDays: number;
  plannedDate: string;
  lines: PlanLine[];
  history: ArchivedRound[];
};

type Recommendation = {
  product: Product;
  sold: number;
  daysCover: number | null;
  suggested: number;
  supplier: string;
  unitCost: number;
};

const STORAGE_VERSION = 1;
const TARGET_DAY_OPTIONS = [7, 14, 21, 30];

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function makeId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emptyWorkbench(): WorkbenchState {
  return { targetDays: 14, plannedDate: "", lines: [], history: [] };
}

function isPlanLine(value: unknown): value is PlanLine {
  if (!value || typeof value !== "object") return false;
  const line = value as Partial<PlanLine>;
  return typeof line.id === "string"
    && typeof line.productId === "string"
    && typeof line.name === "string"
    && typeof line.unit === "string"
    && typeof line.quantity === "number"
    && Number.isFinite(line.quantity)
    && typeof line.unitCost === "number"
    && Number.isFinite(line.unitCost)
    && typeof line.supplier === "string"
    && typeof line.ordered === "boolean";
}

function loadWorkbench(key: string): WorkbenchState {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return { ...emptyWorkbench(), plannedDate: todayKey() };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...emptyWorkbench(), plannedDate: todayKey() };
    const saved = parsed as Partial<WorkbenchState> & { version?: number };
    if (saved.version !== STORAGE_VERSION) return { ...emptyWorkbench(), plannedDate: todayKey() };
    return {
      targetDays: TARGET_DAY_OPTIONS.includes(saved.targetDays ?? -1) ? saved.targetDays! : 14,
      plannedDate: typeof saved.plannedDate === "string" ? saved.plannedDate : todayKey(),
      lines: Array.isArray(saved.lines) ? saved.lines.filter(isPlanLine) : [],
      history: Array.isArray(saved.history)
        ? saved.history.filter((round): round is ArchivedRound =>
            Boolean(round)
            && typeof round === "object"
            && typeof round.id === "string"
            && typeof round.date === "string"
            && typeof round.archivedAt === "number"
            && Array.isArray(round.lines)
            && round.lines.every(isPlanLine),
          ).slice(0, 10)
        : [],
    };
  } catch {
    return { ...emptyWorkbench(), plannedDate: todayKey() };
  }
}

function downloadOrder(lines: PlanLine[], plannedDate: string) {
  const contents = [
    ["Product", "Quantity", "Unit", "Supplier", "Unit cost", "Estimated total", "Order date"],
    ...lines.map((line) => [
      line.name,
      line.quantity,
      line.unit,
      line.supplier,
      line.unitCost,
      line.quantity * line.unitCost,
      plannedDate,
    ]),
  ].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${contents}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `kokan-order-plan-${plannedDate || todayKey()}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface OwnerWorkbenchProps {
  /** Stable store ID, used to keep this store's private plan separate on this device. */
  storeId: string;
  products: Product[];
  invoices: Invoice[];
  operations: OperationsRecord[];
}

export function OwnerWorkbench({ storeId, products, invoices, operations }: OwnerWorkbenchProps) {
  const storageKey = `kokan-owner-workbench:v${STORAGE_VERSION}:${encodeURIComponent(storeId)}`;
  const [workbench, setWorkbench] = useState<WorkbenchState>(emptyWorkbench);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [showAllRecommendations, setShowAllRecommendations] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setWorkbench(loadWorkbench(storageKey));
      setLoadedKey(storageKey);
      setSaved(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [storageKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => setAsOf(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (loadedKey !== storageKey) return;
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({ version: STORAGE_VERSION, ...workbench }));
        setSaved(true);
        setStorageUnavailable(false);
      } catch {
        setSaved(false);
        setStorageUnavailable(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadedKey, storageKey, workbench]);

  const targetDays = workbench.targetDays;
  const recommendations = useMemo(() => {
    if (asOf === null) return [];
    const cutoff = asOf - 30 * 24 * 60 * 60 * 1000;
    const demand = new Map<string, number>();
    for (const invoice of invoices) {
      if (invoice.createdAt < cutoff || invoice.createdAt > asOf) continue;
      for (const item of invoice.items) {
        demand.set(item.productId, (demand.get(item.productId) ?? 0) + item.quantity);
      }
    }
    for (const operation of operations) {
      if (operation.createdAt < cutoff || operation.createdAt > asOf || operation.payload.kind !== "return") continue;
      demand.set(operation.payload.productId, (demand.get(operation.payload.productId) ?? 0) - operation.payload.quantity);
    }
    const latestPurchases = new Map<string, { supplier: string; unitCost: number; createdAt: number }>();
    for (const operation of operations) {
      if (operation.payload.kind !== "purchase") continue;
      const current = latestPurchases.get(operation.payload.productId);
      if (!current || operation.createdAt > current.createdAt) {
        latestPurchases.set(operation.payload.productId, {
          supplier: operation.payload.supplier,
          unitCost: operation.payload.unitCost,
          createdAt: operation.createdAt,
        });
      }
    }

    return products.map((product): Recommendation => {
      const sold = Math.max(0, demand.get(product.id) ?? 0);
      const dailyDemand = sold / 30;
      const suggested = dailyDemand > 0 ? Math.max(0, Math.ceil(dailyDemand * targetDays - product.stockQty)) : 0;
      const lastPurchase = latestPurchases.get(product.id);
      return {
        product,
        sold,
        daysCover: dailyDemand > 0 ? product.stockQty / dailyDemand : null,
        suggested,
        supplier: lastPurchase?.supplier ?? "",
        unitCost: lastPurchase?.unitCost ?? product.costPrice,
      };
    }).filter((item) => item.suggested > 0).sort((a, b) =>
      (a.daysCover ?? Number.POSITIVE_INFINITY) - (b.daysCover ?? Number.POSITIVE_INFINITY) || b.suggested - a.suggested,
    );
  }, [asOf, invoices, operations, products, targetDays]);

  const plannedTotal = workbench.lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0);
  const pendingCount = workbench.lines.filter((line) => !line.ordered).length;
  const inPlan = new Set(workbench.lines.map((line) => line.productId));
  const isReady = loadedKey === storageKey;

  const updateLine = (id: string, patch: Partial<PlanLine>) => {
    setWorkbench((current) => ({
      ...current,
      lines: current.lines.map((line) => line.id === id ? { ...line, ...patch } : line),
    }));
    setSaved(false);
  };

  const addRecommendation = (recommendation: Recommendation) => {
    const { product, suggested, supplier, unitCost } = recommendation;
    setWorkbench((current) => ({
      ...current,
      lines: [...current.lines, {
        id: makeId(),
        productId: product.id,
        name: product.name,
        unit: product.unit,
        quantity: suggested,
        unitCost,
        supplier,
        ordered: false,
      }],
    }));
    setSaved(false);
  };

  const archiveRound = () => {
    if (!workbench.lines.length) return;
    const round: ArchivedRound = {
      id: makeId(),
      date: workbench.plannedDate || todayKey(),
      archivedAt: Date.now(),
      lines: workbench.lines.map((line) => ({ ...line })),
    };
    setWorkbench((current) => ({
      ...current,
      lines: [],
      plannedDate: todayKey(),
      history: [round, ...current.history].slice(0, 10),
    }));
    setSaved(false);
  };

  const updateTargetDays = (days: number) => {
    setWorkbench((current) => ({ ...current, targetDays: days }));
    setSaved(false);
  };

  return (
    <section className="owner-workbench">
      <style jsx>{`
        .owner-workbench { --ink:#19392b; --muted:#718276; --line:#e4ebe4; --green:#237348; color:var(--ink); }
        .workbench-card { overflow:hidden; border:1px solid var(--line); border-radius:20px; background:#fff; box-shadow:0 12px 32px rgba(27,57,38,.055); }
        .workbench-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; padding:22px 24px 18px; border-bottom:1px solid #edf1ec; }
        .workbench-kicker { display:flex; align-items:center; gap:7px; color:#77877a; font-size:11px; font-weight:750; letter-spacing:.1em; text-transform:uppercase; }
        .workbench-head h2 { margin:8px 0 5px; font-size:clamp(21px,3vw,28px); letter-spacing:-.04em; }
        .workbench-head p { margin:0; color:var(--muted); font-size:13px; line-height:1.55; }
        .save-state { display:inline-flex; flex:0 0 auto; align-items:center; gap:6px; padding:7px 10px; border:1px solid #e6eee6; border-radius:999px; background:#f7faf6; color:#52715b; font-size:11px; font-weight:700; }
        .workbench-controls { display:flex; flex-wrap:wrap; align-items:center; gap:12px; padding:14px 24px; background:#fbfcfa; }
        .control-group { display:flex; align-items:center; gap:8px; color:#66766a; font-size:12px; font-weight:650; }
        .control-group select,.control-group input { min-height:38px; padding:0 11px; border:1px solid #dfe7df; border-radius:10px; background:white; color:#244331; font:inherit; }
        .control-group input { width:150px; }
        .workbench-grid { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(320px,.9fr); gap:16px; padding:18px 24px 22px; }
        .workbench-panel { min-width:0; border:1px solid #e7ece7; border-radius:15px; background:#fff; }
        .panel-head { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:14px 16px; border-bottom:1px solid #eef2ed; }
        .panel-title { display:flex; align-items:center; gap:8px; }
        .panel-title h3 { margin:0; font-size:14px; letter-spacing:-.02em; }
        .panel-title svg { color:var(--green); }
        .panel-caption { margin:4px 0 0; color:#819084; font-size:11px; }
        .count-pill { padding:5px 8px; border-radius:999px; background:#eff7ef; color:#39764c; font-size:10px; font-weight:750; white-space:nowrap; }
        .text-button { padding:5px 0; border:0; background:transparent; color:#32734a; font:inherit; font-size:10px; font-weight:700; cursor:pointer; white-space:nowrap; }
        .text-button:hover { color:#1e5634; text-decoration:underline; }
        .suggestion-list { padding:0 14px; }
        .suggestion { display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px; align-items:center; padding:12px 2px; border-bottom:1px solid #f0f3ef; }
        .suggestion:last-child { border-bottom:0; }
        .product-name { display:block; overflow:hidden; color:#294333; font-size:13px; font-weight:730; text-overflow:ellipsis; white-space:nowrap; }
        .product-meta { display:block; margin-top:4px; color:#849186; font-size:10px; line-height:1.45; }
        .suggestion-action { display:flex; align-items:center; gap:10px; }
        .suggestion-qty { text-align:right; }
        .suggestion-qty strong { display:block; color:#275b3b; font-size:13px; }
        .suggestion-qty small { color:#819084; font-size:10px; }
        .icon-button,.small-button,.action-button { display:inline-flex; align-items:center; justify-content:center; gap:7px; min-height:36px; border:1px solid #dce8dd; border-radius:10px; background:#fff; color:#346448; font:inherit; font-size:11px; font-weight:700; cursor:pointer; transition:background .15s,border-color .15s,transform .15s; }
        .icon-button { width:36px; }
        .small-button { padding:0 11px; }
        .action-button { padding:0 12px; }
        .action-button-primary { border-color:#28764a; background:#28764a; color:white; }
        .icon-button:hover,.small-button:hover,.action-button:hover { border-color:#88ad8e; background:#f4f9f4; }
        .action-button-primary:hover { background:#1e633d; color:white; }
        .icon-button:active,.small-button:active,.action-button:active { transform:translateY(1px); }
        .icon-button:focus-visible,.small-button:focus-visible,.action-button:focus-visible,.control-group select:focus-visible,.control-group input:focus-visible,.line-input:focus-visible { outline:3px solid #b5d8bb; outline-offset:2px; }
        .icon-button:disabled,.small-button:disabled,.action-button:disabled { opacity:.48; cursor:not-allowed; }
        .empty-state { display:grid; justify-items:center; gap:7px; padding:28px 18px; color:#829084; text-align:center; }
        .empty-state strong { color:#42584a; font-size:13px; }
        .empty-state span { max-width:280px; font-size:11px; line-height:1.5; }
        .plan-total { display:flex; justify-content:space-between; gap:12px; padding:12px 16px; border-top:1px solid #eef2ed; background:#fafcf9; color:#718075; font-size:11px; }
        .plan-total strong { color:#294a34; font-size:13px; }
        .line-list { padding:0 14px; }
        .plan-line { padding:13px 2px; border-bottom:1px solid #f0f3ef; }
        .line-top { display:flex; justify-content:space-between; align-items:center; gap:8px; }
        .line-top .product-name { flex:1; }
        .line-tools { display:flex; align-items:center; gap:5px; }
        .line-fields { display:grid; grid-template-columns:1fr .75fr .95fr auto; gap:7px; margin-top:9px; }
        .line-input { width:100%; min-width:0; min-height:34px; padding:0 8px; border:1px solid #e1e8e1; border-radius:8px; color:#395442; font:inherit; font-size:11px; }
        .line-input[type="number"] { text-align:right; }
        .line-input:disabled { background:#f3f6f2; color:#849186; }
        .ordered-toggle { min-height:34px; padding:0 9px; border:1px solid #dfe8df; border-radius:8px; background:#fff; color:#64806a; font:inherit; font-size:10px; font-weight:700; cursor:pointer; }
        .ordered-toggle[aria-pressed="true"] { border-color:#bdd9c2; background:#edf7ef; color:#2c7546; }
        .line-ordered .product-name { color:#839087; text-decoration:line-through; }
        .workbench-foot { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; padding:14px 16px; border-top:1px solid #eef2ed; }
        .workbench-actions { display:flex; flex-wrap:wrap; gap:8px; }
        .history { margin:0 24px 20px; border:1px solid #e7ece7; border-radius:15px; }
        .history summary { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:13px 15px; color:#40584a; font-size:12px; font-weight:730; cursor:pointer; list-style:none; }
        .history summary::-webkit-details-marker { display:none; }
        .history-list { padding:0 15px 10px; }
        .history-row { display:flex; justify-content:space-between; gap:12px; padding:10px 0; border-top:1px solid #eef2ed; color:#718075; font-size:11px; }
        .history-row strong { color:#40584a; }
        .workbench-note { margin:0 24px 20px; color:#829084; font-size:10px; line-height:1.5; }
        @media (max-width:760px) {
          .workbench-head { padding:18px 16px 15px; }
          .workbench-head p { font-size:12px; }
          .workbench-controls { padding:12px 16px; }
          .workbench-grid { grid-template-columns:minmax(0,1fr); gap:12px; padding:14px 16px 18px; }
          .history { margin-right:16px; margin-left:16px; }
          .workbench-note { margin-right:16px; margin-left:16px; }
        }
        @media (max-width:420px) {
          .workbench-head { flex-direction:column; gap:12px; }
          .workbench-controls { align-items:flex-start; flex-direction:column; gap:9px; }
          .line-fields { grid-template-columns:.75fr .8fr 1fr; }
          .ordered-toggle { grid-column:1 / -1; }
          .workbench-foot { align-items:flex-start; flex-direction:column; }
        }
      `}</style>

      <div className="workbench-card">
        {!isReady ? (
          <div className="empty-state" role="status">Loading this store’s local order plan…</div>
        ) : (
          <>
        <header className="workbench-head">
          <div>
            <div className="workbench-kicker"><ShoppingBasket size={14} /> Owner workbench · buying plan</div>
            <h2>Plan the next order</h2>
            <p>Turn recent demand into a supplier-ready list. Review quantities before contacting suppliers.</p>
          </div>
          <span className="save-state" role="status" aria-live="polite">
            {storageUnavailable ? <RotateCcw size={13} /> : <Check size={13} />}
            {storageUnavailable ? "Local save unavailable" : saved ? "Saved on this device" : "Saving…"}
          </span>
        </header>

        <div className="workbench-controls">
          <label className="control-group">Cover target
            <select value={workbench.targetDays} onChange={(event) => updateTargetDays(Number(event.target.value))}>
              {TARGET_DAY_OPTIONS.map((days) => <option key={days} value={days}>{days} days</option>)}
            </select>
          </label>
          <label className="control-group"><CalendarDays size={15} /> Planned order date
            <input type="date" value={workbench.plannedDate} onChange={(event) => {
              setWorkbench((current) => ({ ...current, plannedDate: event.target.value }));
              setSaved(false);
            }} />
          </label>
        </div>

        <div className="workbench-grid">
          <section className="workbench-panel" aria-labelledby="suggestions-title">
            <div className="panel-head">
              <div>
                <div className="panel-title"><PackagePlus size={16} /><h3 id="suggestions-title">Suggested to review</h3></div>
                <p className="panel-caption">Net units sold over 30 days · target stock less current on-hand</p>
              </div>
              <div className="suggestion-action">
                <span className="count-pill">{recommendations.length} items</span>
                {recommendations.length > 8 && <button className="text-button" onClick={() => setShowAllRecommendations((current) => !current)}>{showAllRecommendations ? "Show fewer" : "Show all"}</button>}
              </div>
            </div>
            {recommendations.length ? (
              <div className="suggestion-list">
                {recommendations.slice(0, showAllRecommendations ? recommendations.length : 8).map((recommendation) => {
                  const { product, suggested, daysCover, sold, supplier, unitCost } = recommendation;
                  const added = inPlan.has(product.id);
                  return (
                    <article className="suggestion" key={product.id}>
                      <div>
                        <strong className="product-name">{product.name}</strong>
                        <span className="product-meta">
                          {product.stockQty} {product.unit} on hand · {sold.toFixed(0)} sold / 30d
                          {daysCover !== null ? ` · ${Math.floor(daysCover)}d cover` : ""}
                          <br />{supplier ? `Last supplier: ${supplier}` : "Supplier not recorded yet"} · {formatMoney(unitCost)}/{product.unit}
                        </span>
                      </div>
                      <div className="suggestion-action">
                        <div className="suggestion-qty"><strong>+{suggested}</strong><small>{product.unit}</small></div>
                        <button className="icon-button" onClick={() => addRecommendation(recommendation)} disabled={added} aria-label={added ? `${product.name} is already in the plan` : `Add ${product.name} to the order plan`} title={added ? "Already in this plan" : "Add to plan"}>
                          {added ? <Check size={15} /> : <PackagePlus size={15} />}
                        </button>
                      </div>
                    </article>
                  );
                })}
                {recommendations.length > 8 && !showAllRecommendations && <p className="panel-caption">Showing 8 of {recommendations.length} suggestions.</p>}
              </div>
            ) : (
              <div className="empty-state"><Check size={21} /><strong>Nothing needs replenishing yet</strong><span>As sales are recorded and stock falls below your chosen cover target, review suggestions will appear here.</span></div>
            )}
          </section>

          <section className="workbench-panel" aria-labelledby="plan-title">
            <div className="panel-head">
              <div>
                <div className="panel-title"><ClipboardList size={16} /><h3 id="plan-title">Your order plan</h3></div>
                <p className="panel-caption">Adjust quantities and supplier details before ordering.</p>
              </div>
              <span className="count-pill">{pendingCount} to order</span>
            </div>
            {workbench.lines.length ? (
              <>
                <div className="line-list">
                  {workbench.lines.map((line) => (
                    <article className={`plan-line${line.ordered ? " line-ordered" : ""}`} key={line.id}>
                      <div className="line-top">
                        <strong className="product-name">{line.name}</strong>
                        <div className="line-tools">
                          <button className="ordered-toggle" aria-pressed={line.ordered} onClick={() => updateLine(line.id, { ordered: !line.ordered })}>
                            {line.ordered ? "Ordered" : "Mark ordered"}
                          </button>
                          <button className="icon-button" aria-label={`Remove ${line.name} from plan`} onClick={() => {
                            setWorkbench((current) => ({ ...current, lines: current.lines.filter((item) => item.id !== line.id) }));
                            setSaved(false);
                          }}><Trash2 size={14} /></button>
                        </div>
                      </div>
                      <div className="line-fields">
                        <input className="line-input" aria-label={`${line.name} quantity in ${line.unit}`} type="number" min="1" step="1" value={line.quantity} disabled={line.ordered} onChange={(event) => updateLine(line.id, { quantity: Math.max(1, Math.floor(Number(event.target.value) || 1)) })} />
                        <input className="line-input" aria-label={`${line.name} unit cost`} type="number" min="0" step="0.01" value={line.unitCost} disabled={line.ordered} onChange={(event) => updateLine(line.id, { unitCost: Math.max(0, Number(event.target.value) || 0) })} />
                        <input className="line-input" aria-label={`${line.name} supplier`} type="text" maxLength={60} placeholder="Supplier" value={line.supplier} disabled={line.ordered} onChange={(event) => updateLine(line.id, { supplier: event.target.value })} />
                        <span className="product-meta" aria-label="Estimated line total">{formatMoney(line.quantity * line.unitCost)}</span>
                      </div>
                    </article>
                  ))}
                </div>
                <div className="plan-total"><span>{workbench.lines.length} planned products · {workbench.lines.filter((line) => line.ordered).length} marked ordered</span><strong>Estimate {formatMoney(plannedTotal)}</strong></div>
                <div className="workbench-foot">
                  <span className="panel-caption">Marking ordered is a reminder only; it does not change stock or record a purchase.</span>
                  <div className="workbench-actions">
                    <button className="small-button" onClick={() => downloadOrder(workbench.lines, workbench.plannedDate)}><Download size={14} /> Export CSV</button>
                    <button className="action-button action-button-primary" onClick={archiveRound}><Archive size={14} /> Archive round</button>
                  </div>
                </div>
              </>
            ) : (
              <div className="empty-state"><ShoppingBasket size={21} /><strong>Your next order starts here</strong><span>Add a suggested product, then edit its quantity, cost, or supplier. Your draft stays on this device.</span></div>
            )}
          </section>
        </div>

        {workbench.history.length > 0 && (
          <details className="history">
            <summary><span>Recent archived order rounds</span><span>{workbench.history.length} saved</span></summary>
            <div className="history-list">
              {workbench.history.slice(0, 5).map((round) => (
                <div className="history-row" key={round.id}>
                  <span><strong>{new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(`${round.date}T00:00:00`))}</strong> · {round.lines.length} products</span>
                  <strong>{formatMoney(round.lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0))}</strong>
                </div>
              ))}
            </div>
          </details>
        )}
        <p className="workbench-note">Planning estimates use this device’s last 30 days of sales and returns. Supplier names and unit cost come from the latest recorded purchase when available; confirm pack sizes, lead times, and prices before ordering. This plan is local to this device and does not change inventory.</p>
          </>
        )}
      </div>
    </section>
  );
}
