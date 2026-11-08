"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, BadgeCheck, Check, Download, Search, ShieldCheck, TriangleAlert } from "lucide-react";
import type { Invoice, OperationsRecord, Product } from "@/lib/db";
import { csvCell, formatMoney } from "@/lib/format";

type ReviewStatus = "recommended" | "guardrail" | "on_target" | "cost_missing";
type ReviewFilter = "all" | "recommended" | "guardrail" | "on_target" | "cost_missing";

interface MarginReviewRow {
  product: Product;
  modeledCost: number;
  latestPurchaseCost: number | null;
  currentMargin: number | null;
  suggestedPrice: number | null;
  increasePercent: number | null;
  netUnitsSold: number;
  realizedPrice: number | null;
  status: ReviewStatus;
}

interface PlannedPriceChange {
  productId: string;
  name: string;
  currentPrice: number;
  suggestedPrice: number;
  catalogCost: number;
  latestPurchaseCost: number | null;
}

export interface AdminMarginReviewProps {
  products: Product[];
  invoices: Invoice[];
  operations: OperationsRecord[];
  onUpdateSellingPrice: (productId: string, sellingPrice: number) => Promise<boolean>;
}

const DAYS_30 = 30 * 24 * 60 * 60 * 1000;

function downloadCsv(rows: (string | number)[][]) {
  const contents = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${contents}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `kokan-margin-review-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function statusLabel(status: ReviewStatus): string {
  switch (status) {
    case "recommended": return "Price review";
    case "guardrail": return "Increase capped";
    case "on_target": return "On target";
    case "cost_missing": return "Cost needed";
  }
}

export function AdminMarginReview({
  products,
  invoices,
  operations,
  onUpdateSellingPrice,
}: AdminMarginReviewProps) {
  const [asOf, setAsOf] = useState<number | null>(null);
  const [targetMarginInput, setTargetMarginInput] = useState("25");
  const [maxIncreaseInput, setMaxIncreaseInput] = useState("40");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<PlannedPriceChange[] | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setAsOf(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const targetMargin = Number(targetMarginInput);
  const maxIncrease = Number(maxIncreaseInput);
  const targetValid = Number.isFinite(targetMargin) && targetMargin >= 5 && targetMargin <= 80;
  const maxIncreaseValid = Number.isFinite(maxIncrease) && maxIncrease >= 1 && maxIncrease <= 100;
  const reviewTargetMargin = targetValid ? targetMargin : 25;
  const reviewMaxIncrease = maxIncreaseValid ? maxIncrease : 40;

  const rows = useMemo(() => {
    if (asOf === null) return [];
    const cutoff = asOf - DAYS_30;
    const sales = new Map<string, { units: number; revenue: number }>();
    const returned = new Map<string, { units: number; amount: number }>();
    const latestPurchases = new Map<string, { cost: number; createdAt: number }>();

    for (const invoice of invoices) {
      if (invoice.createdAt < cutoff || invoice.createdAt > asOf) continue;
      for (const item of invoice.items) {
        if (!Number.isFinite(item.quantity) || item.quantity <= 0) continue;
        const totals = sales.get(item.productId) ?? { units: 0, revenue: 0 };
        totals.units += item.quantity;
        totals.revenue += Number.isFinite(item.lineTotal) ? item.lineTotal : item.unitPrice * item.quantity;
        sales.set(item.productId, totals);
      }
    }

    for (const operation of operations) {
      if (operation.createdAt > asOf) continue;
      if (operation.payload.kind === "return" && operation.createdAt >= cutoff) {
        const totals = returned.get(operation.payload.productId) ?? { units: 0, amount: 0 };
        totals.units += Math.max(0, operation.payload.quantity);
        totals.amount += Math.max(0, operation.payload.amount);
        returned.set(operation.payload.productId, totals);
      } else if (operation.payload.kind === "purchase" && Number.isFinite(operation.payload.unitCost) && operation.payload.unitCost > 0) {
        const current = latestPurchases.get(operation.payload.productId);
        if (!current || operation.createdAt > current.createdAt) {
          latestPurchases.set(operation.payload.productId, { cost: operation.payload.unitCost, createdAt: operation.createdAt });
        }
      }
    }

    return products.map((product): MarginReviewRow => {
      const recentSales = sales.get(product.id) ?? { units: 0, revenue: 0 };
      const recentReturns = returned.get(product.id) ?? { units: 0, amount: 0 };
      const netUnitsSold = Math.max(0, recentSales.units - recentReturns.units);
      const netRevenue = Math.max(0, recentSales.revenue - recentReturns.amount);
      const latestPurchaseCost = latestPurchases.get(product.id)?.cost ?? null;
      const modeledCost = Math.max(product.costPrice, latestPurchaseCost ?? product.costPrice);
      const currentMargin = product.sellingPrice > 0 && modeledCost >= 0
        ? ((product.sellingPrice - modeledCost) / product.sellingPrice) * 100
        : null;

      if (!Number.isFinite(modeledCost) || modeledCost <= 0 || !Number.isFinite(product.sellingPrice) || product.sellingPrice <= 0) {
        return { product, modeledCost, latestPurchaseCost, currentMargin, suggestedPrice: null, increasePercent: null, netUnitsSold, realizedPrice: netUnitsSold > 0 ? netRevenue / netUnitsSold : null, status: "cost_missing" };
      }

      const rawPrice = modeledCost / (1 - reviewTargetMargin / 100);
      const suggestedPrice = Math.ceil(rawPrice);
      const increasePercent = ((suggestedPrice - product.sellingPrice) / product.sellingPrice) * 100;
      const needsIncrease = suggestedPrice > product.sellingPrice;
      const status: ReviewStatus = !needsIncrease
        ? "on_target"
        : increasePercent > reviewMaxIncrease ? "guardrail" : "recommended";

      return {
        product,
        modeledCost,
        latestPurchaseCost,
        currentMargin,
        suggestedPrice,
        increasePercent,
        netUnitsSold,
        realizedPrice: netUnitsSold > 0 ? netRevenue / netUnitsSold : null,
        status,
      };
    }).sort((a, b) => {
      const rank: Record<ReviewStatus, number> = { recommended: 0, guardrail: 1, cost_missing: 2, on_target: 3 };
      return rank[a.status] - rank[b.status]
        || b.netUnitsSold - a.netUnitsSold
        || (b.increasePercent ?? 0) - (a.increasePercent ?? 0)
        || a.product.name.localeCompare(b.product.name);
    });
  }, [asOf, invoices, operations, products, reviewMaxIncrease, reviewTargetMargin]);

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      const matchesFilter = filter === "all" || row.status === filter;
      const matchesQuery = !normalizedQuery || [
        row.product.name,
        row.product.category,
        row.product.barcode ?? "",
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery));
      return matchesFilter && matchesQuery;
    });
  }, [filter, query, rows]);
  const selectedRows = rows.filter((row) => selectedIds.has(row.product.id));
  const selectableVisibleRows = visibleRows.filter((row) => row.status === "recommended");
  const allVisibleSelected = selectableVisibleRows.length > 0
    && selectableVisibleRows.every((row) => selectedIds.has(row.product.id));
  const recommendedCount = rows.filter((row) => row.status === "recommended").length;
  const belowTargetCount = rows.filter((row) => row.status === "recommended" || row.status === "guardrail").length;
  const latestCostCount = rows.filter((row) => row.latestPurchaseCost !== null && row.latestPurchaseCost > row.product.costPrice).length;
  const targetError = targetMarginInput !== "" && !targetValid;
  const increaseError = maxIncreaseInput !== "" && !maxIncreaseValid;

  const toggleProduct = (productId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
    setPreview(null);
    setFeedback("");
  };

  const toggleVisible = () => {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const row of selectableVisibleRows) {
        if (allVisibleSelected) next.delete(row.product.id);
        else next.add(row.product.id);
      }
      return next;
    });
    setPreview(null);
    setFeedback("");
  };

  const startPreview = () => {
    if (!targetValid || !maxIncreaseValid || !selectedRows.length || selectedRows.some((row) => row.status !== "recommended")) return;
    setPreview(selectedRows.map((row) => ({
      productId: row.product.id,
      name: row.product.name,
      currentPrice: row.product.sellingPrice,
      suggestedPrice: row.suggestedPrice as number,
      catalogCost: row.product.costPrice,
      latestPurchaseCost: row.latestPurchaseCost,
    })));
    setFeedback("");
  };

  const applyPreview = async () => {
    if (!preview || isApplying) return;
    const changes = preview;
    const hasStalePrices = changes.some((change) => {
      const product = products.find((item) => item.id === change.productId);
      const latestPurchaseCost = rows.find((row) => row.product.id === change.productId)?.latestPurchaseCost ?? null;
      return !product
        || product.sellingPrice !== change.currentPrice
        || product.costPrice !== change.catalogCost
        || latestPurchaseCost !== change.latestPurchaseCost;
    });
    if (hasStalePrices) {
      setPreview(null);
      setFeedback("The catalog or purchase cost changed after this preview. Review the refreshed prices before applying.");
      return;
    }

    setIsApplying(true);
    let updated = 0;
    const failed = new Set<string>();
    for (const change of changes) {
      const latestProduct = products.find((product) => product.id === change.productId);
      if (!latestProduct || latestProduct.sellingPrice !== change.currentPrice || change.suggestedPrice <= change.currentPrice) {
        failed.add(change.productId);
        continue;
      }
      try {
        if (await onUpdateSellingPrice(change.productId, change.suggestedPrice)) updated += 1;
        else failed.add(change.productId);
      } catch {
        failed.add(change.productId);
      }
    }

    setSelectedIds((current) => {
      const next = new Set(current);
      for (const change of changes) {
        if (!failed.has(change.productId)) next.delete(change.productId);
      }
      return next;
    });
    setPreview(null);
    setIsApplying(false);
    const failedNames = changes.filter((change) => failed.has(change.productId)).map((change) => change.name);
    setFeedback(`${updated} price${updated === 1 ? "" : "s"} updated${failed.size ? ` · ${failed.size} need another review: ${failedNames.join(", ")}` : ""}.`);
  };

  const exportReview = () => {
    downloadCsv([
      ["Product ID", "Product", "Category", "Unit", "Stock on hand", "Current selling price", "Catalog cost", "Latest recorded purchase cost", "Review cost basis", "Current gross margin %", "Net units sold / 30d", "Realized price / unit", "Target gross margin %", "Suggested price", "Price increase %", "Review status", "Selected"],
      ...rows.map((row) => [
        row.product.id,
        row.product.name,
        row.product.category,
        row.product.unit,
        row.product.stockQty,
        row.product.sellingPrice,
        row.product.costPrice,
        row.latestPurchaseCost ?? "",
        row.modeledCost,
        row.currentMargin === null ? "" : row.currentMargin.toFixed(1),
        row.netUnitsSold,
        row.realizedPrice === null ? "" : row.realizedPrice.toFixed(2),
        targetValid ? targetMargin : "",
        row.suggestedPrice ?? "",
        row.increasePercent === null ? "" : row.increasePercent.toFixed(1),
        statusLabel(row.status),
        selectedIds.has(row.product.id) ? "Yes" : "No",
      ]),
    ]);
  };

  return (
    <section className="admin-margin-review">
      <header className="review-hero">
        <div className="review-hero-copy">
          <span className="review-eyebrow"><ShieldCheck size={14} /> ADMIN · PRICING CONTROL</span>
          <h2>Margin review</h2>
          <p>Find prices squeezed by today’s costs, preview a guarded correction, and apply only the changes you approve.</p>
        </div>
        <div className="review-hero-stats">
          <span><strong>{belowTargetCount}</strong> below target</span>
          <span><strong>{latestCostCount}</strong> products with higher last-buy cost</span>
        </div>
      </header>

      <section className="review-card review-controls" aria-label="Pricing review settings">
        <div className="review-card-heading">
          <div><h3>Set your guardrails</h3><p>Price suggestions use the higher of catalog cost or the latest recorded purchase cost.</p></div>
          <button type="button" className="review-export" onClick={exportReview} disabled={!rows.length}><Download size={15} /> Export CSV</button>
        </div>
        <div className="review-settings">
          <label>
            <span>Target gross margin</span>
            <div className="review-number-wrap"><input type="number" min="5" max="80" step="1" value={targetMarginInput} aria-invalid={targetError} onChange={(event) => { setTargetMarginInput(event.target.value); setPreview(null); setFeedback(""); }} /><b>%</b></div>
            <small>Allowed range: 5–80%</small>
          </label>
          <label>
            <span>Maximum price increase</span>
            <div className="review-number-wrap"><input type="number" min="1" max="100" step="1" value={maxIncreaseInput} aria-invalid={increaseError} onChange={(event) => { setMaxIncreaseInput(event.target.value); setPreview(null); setFeedback(""); }} /><b>%</b></div>
            <small>Higher jumps are held for manual review.</small>
          </label>
          <div className="review-rule"><BadgeCheck size={18} /><span><strong>Validated before saving</strong><small>Zero-cost items, stale prices, and jumps above your cap cannot be bulk-applied.</small></span></div>
        </div>
        {(targetError || increaseError) && <p className="review-validation" role="alert">{targetError ? "Enter a target margin from 5% to 80%." : "Enter a maximum increase from 1% to 100%."}</p>}
      </section>

      <section className="review-card review-table-card">
        <div className="review-card-heading review-table-heading">
          <div><h3>Products to review</h3><p>{recommendedCount} price changes are within your guardrail · 30-day sales and returns included</p></div>
          <div className="review-actions">
            <label className="review-search"><Search size={15} /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find product" aria-label="Find product" /></label>
            <select className="review-filter" value={filter} onChange={(event) => setFilter(event.target.value as ReviewFilter)} aria-label="Filter pricing review">
              <option value="all">All products</option><option value="recommended">Ready to update</option><option value="guardrail">Increase capped</option><option value="on_target">On target</option><option value="cost_missing">Cost needed</option>
            </select>
          </div>
        </div>

        {asOf === null ? <div className="review-empty">Preparing the last 30 days of sales, returns, and purchase costs…</div> : (
          <>
            <div className="review-table-scroll">
              <table className="review-table">
                <thead><tr>
                  <th className="review-select-cell"><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} aria-label="Select all visible price recommendations" /></th>
                  <th>Product</th><th>Cost basis</th><th>Current margin</th><th>Sales / 30d</th><th>Current price</th><th>Suggested price</th><th>Review</th>
                </tr></thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr key={row.product.id}>
                      <td className="review-select-cell">{row.status === "recommended" && <input type="checkbox" checked={selectedIds.has(row.product.id)} onChange={() => toggleProduct(row.product.id)} aria-label={`Select ${row.product.name}`} />}</td>
                      <td><span className="review-product-name">{row.product.name}</span><small>{row.product.category} · {row.product.stockQty} {row.product.unit} on hand</small></td>
                      <td><strong>{formatMoney(row.modeledCost)}</strong>{row.latestPurchaseCost !== null && row.latestPurchaseCost > row.product.costPrice && <small className="review-cost-rise">Latest buy {formatMoney(row.latestPurchaseCost)}</small>}</td>
                      <td>{row.currentMargin === null ? "—" : <><strong>{row.currentMargin.toFixed(1)}%</strong><small>Target {targetValid ? `${targetMargin}%` : "—"}</small></>}</td>
                      <td><strong>{row.netUnitsSold} {row.product.unit}</strong><small>{row.realizedPrice === null ? "No recent sale" : `${formatMoney(row.realizedPrice)} realized / unit`}</small></td>
                      <td>{formatMoney(row.product.sellingPrice)}</td>
                      <td className={row.status === "recommended" || row.status === "guardrail" ? "review-proposed" : ""}>{row.suggestedPrice === null ? "—" : row.suggestedPrice > row.product.sellingPrice ? <><strong>{formatMoney(row.suggestedPrice)}</strong><small>+{row.increasePercent?.toFixed(1)}%</small></> : "No change"}</td>
                      <td><span className={`review-status review-status-${row.status}`}><span />{statusLabel(row.status)}</span></td>
                    </tr>
                  ))}
                  {!visibleRows.length && <tr><td className="review-no-results" colSpan={8}>{rows.length ? "No products match these filters." : "No products are available for pricing review yet."}</td></tr>}
                </tbody>
              </table>
            </div>

            <div className="review-table-footer">
              <span>{selectedRows.length} selected · Increase is rounded up to the next ₹1</span>
              <div>
                <button type="button" className="review-clear" onClick={() => { setSelectedIds(new Set()); setPreview(null); }} disabled={!selectedIds.size || isApplying}>Clear selection</button>
                <button type="button" className="review-primary" onClick={startPreview} disabled={!targetValid || !maxIncreaseValid || !selectedRows.length || selectedRows.some((row) => row.status !== "recommended") || isApplying}>
                  Review {selectedRows.length || ""} change{selectedRows.length === 1 ? "" : "s"} <ArrowUpRight size={15} />
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {preview && <section className="review-card review-preview" aria-live="polite">
        <div className="review-card-heading">
          <div><h3>Confirm price changes</h3><p>Nothing is saved until you apply. Each update is sent through the parent’s product-update callback.</p></div>
          <button type="button" className="review-clear" onClick={() => setPreview(null)} disabled={isApplying}>Cancel</button>
        </div>
        <div className="review-preview-list">{preview.map((change) => <div key={change.productId}><strong>{change.name}</strong><span>{formatMoney(change.currentPrice)} <ArrowUpRight size={13} /> {formatMoney(change.suggestedPrice)}</span></div>)}</div>
        <div className="review-preview-footer"><span>{preview.length} validated update{preview.length === 1 ? "" : "s"} · changes apply one product at a time</span><button type="button" className="review-primary" onClick={() => void applyPreview()} disabled={isApplying}>{isApplying ? "Applying…" : <><Check size={15} /> Apply reviewed prices</>}</button></div>
      </section>}

      {feedback && <p className="review-feedback" role="status">{feedback}</p>}
      <p className="review-footnote"><TriangleAlert size={14} /> Guidance only: this estimates a unit gross margin from the target and recorded cost. Review local competitor prices, tax, and shop policy before changing a shelf price. Recent realized prices are context, not a demand forecast.</p>

      <style jsx>{`
        .admin-margin-review { display: grid; gap: 14px; color: #20352b; }
        .review-hero { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; padding: 21px 23px; border: 1px solid #dfe9df; border-radius: 17px; background: radial-gradient(circle at 95% 0%, rgba(245, 199, 101, .34), transparent 34%), linear-gradient(120deg, #173f30, #24694a); color: white; box-shadow: 0 9px 22px rgba(27, 74, 49, .13); }
        .review-hero-copy { max-width: 650px; }
        .review-eyebrow { display: inline-flex; align-items: center; gap: 7px; color: #d3e8d7; font-size: 9px; font-weight: 780; letter-spacing: 1.15px; }
        .review-hero h2 { margin: 8px 0 5px; font-size: clamp(22px, 3vw, 29px); letter-spacing: -.8px; line-height: 1.1; }
        .review-hero p { max-width: 590px; margin: 0; color: #d3e1d5; font-size: 12px; line-height: 1.55; }
        .review-hero-stats { display: flex; flex: 0 0 auto; gap: 8px; }
        .review-hero-stats span { display: grid; min-width: 118px; gap: 4px; padding: 10px 12px; border: 1px solid rgba(255,255,255,.2); border-radius: 12px; background: rgba(255,255,255,.09); color: #e3eee4; font-size: 9px; }
        .review-hero-stats strong { color: #ffda84; font-size: 19px; line-height: 1; }
        .review-card { min-width: 0; overflow: hidden; border: 1px solid #e8ece6; border-radius: 15px; background: #fff; box-shadow: 0 5px 18px rgba(31,53,41,.045); }
        .review-card-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 17px 19px 13px; }
        .review-card-heading h3 { margin: 0 0 4px; color: #2b4435; font-size: 14px; font-weight: 740; letter-spacing: -.2px; }
        .review-card-heading p { margin: 0; color: #87938a; font-size: 10px; line-height: 1.45; }
        .review-export, .review-primary, .review-clear { display: inline-flex; min-height: 35px; flex: 0 0 auto; align-items: center; justify-content: center; gap: 7px; padding: 0 11px; border-radius: 9px; cursor: pointer; font-size: 10px; font-weight: 680; }
        .review-export { border: 1px solid #e1e9e1; background: #fff; color: #45634d; }
        .review-export:hover, .review-clear:hover { background: #f5f8f3; }
        .review-export:disabled, .review-primary:disabled, .review-clear:disabled { cursor: not-allowed; opacity: .48; }
        .review-settings { display: grid; grid-template-columns: minmax(150px,.8fr) minmax(180px,1fr) minmax(240px,1.3fr); gap: 13px; align-items: end; padding: 0 19px 17px; }
        .review-settings label { display: grid; gap: 6px; color: #536459; font-size: 10px; font-weight: 680; }
        .review-number-wrap { display: flex; height: 36px; align-items: center; overflow: hidden; border: 1px solid #e4e9e2; border-radius: 8px; background: #fff; }
        .review-number-wrap:focus-within { border-color: #75a481; box-shadow: 0 0 0 3px rgba(65,142,103,.12); }
        .review-number-wrap input { width: 100%; min-width: 0; height: 100%; padding: 0 9px; border: 0; outline: 0; background: transparent; color: #304b38; font-size: 12px; }
        .review-number-wrap input[aria-invalid="true"] { color: #aa4b35; }
        .review-number-wrap b { padding: 0 10px; color: #8b988d; font-size: 10px; }
        .review-settings label small { color: #98a198; font-size: 9px; font-weight: 450; }
        .review-rule { display: flex; min-height: 52px; align-items: center; gap: 9px; padding: 9px 11px; border: 1px solid #e3eee3; border-radius: 10px; background: #f7faf6; color: #478057; }
        .review-rule > span { display: grid; gap: 3px; }
        .review-rule strong { color: #45654a; font-size: 10px; }
        .review-rule small { color: #87978b; font-size: 9px; font-weight: 450; line-height: 1.35; }
        .review-validation { margin: -7px 19px 13px; color: #a64b37; font-size: 10px; }
        .review-table-card { overflow: hidden; }
        .review-table-heading { align-items: flex-start; }
        .review-actions { display: flex; align-items: center; gap: 8px; }
        .review-search { display: flex; width: 165px; height: 34px; align-items: center; gap: 6px; padding: 0 9px; border: 1px solid #e8ece6; border-radius: 8px; color: #8c998f; }
        .review-search:focus-within { border-color: #75a481; }
        .review-search input { width: 100%; min-width: 0; border: 0; outline: 0; color: #34493b; font-size: 10px; }
        .review-filter { height: 34px; max-width: 145px; padding: 0 9px; border: 1px solid #e8ece6; border-radius: 8px; background: white; color: #536459; font-size: 10px; }
        .review-table-scroll { width: 100%; overflow-x: auto; }
        .review-table { width: 100%; border-collapse: collapse; text-align: left; }
        .review-table th { padding: 10px 11px; border-top: 1px solid #f0f2ed; border-bottom: 1px solid #edf0eb; background: #fafbf9; color: #89968b; font-size: 8px; font-weight: 750; letter-spacing: .45px; text-transform: uppercase; white-space: nowrap; }
        .review-table td { min-width: 85px; padding: 11px; border-bottom: 1px solid #f0f2ed; color: #4a5d4e; font-size: 10px; white-space: nowrap; }
        .review-table tbody tr:last-child td { border-bottom: 0; }
        .review-table td > strong { color: #354d3b; font-weight: 690; }
        .review-table td small { display: block; margin-top: 4px; color: #929c93; font-size: 9px; }
        .review-table td .review-product-name { display: block; max-width: 190px; overflow: hidden; color: #344b39; font-size: 10px; font-weight: 710; text-overflow: ellipsis; }
        .review-table td small.review-cost-rise { color: #a46d2a; }
        .review-table th.review-select-cell, .review-table td.review-select-cell { width: 36px; min-width: 36px; padding-right: 1px; padding-left: 15px; }
        .review-select-cell input { width: 14px; height: 14px; accent-color: #26734d; cursor: pointer; }
        .review-proposed { color: #27754d !important; }
        .review-status { display: inline-flex; align-items: center; gap: 6px; padding: 5px 7px; border-radius: 20px; background: #f1f3f0; color: #6d786f; font-size: 9px; font-weight: 650; }
        .review-status > span { width: 6px; height: 6px; border-radius: 50%; background: #8f9b91; }
        .review-status-recommended { background: #edf6ee; color: #28714b; }
        .review-status-recommended > span { background: #37905c; }
        .review-status-guardrail { background: #fff5e7; color: #996622; }
        .review-status-guardrail > span { background: #d3973c; }
        .review-status-cost_missing { background: #fff0ed; color: #a84d3a; }
        .review-status-cost_missing > span { background: #c7684e; }
        .review-no-results { height: 90px; color: #929c93 !important; text-align: center; }
        .review-table-footer { display: flex; min-height: 52px; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 15px; border-top: 1px solid #edf0eb; color: #849087; font-size: 9px; }
        .review-table-footer > div { display: flex; align-items: center; gap: 7px; }
        .review-primary { border: 1px solid #226644; background: #226644; color: white; }
        .review-primary:not(:disabled):hover { border-color: #174f3b; background: #174f3b; }
        .review-clear { min-height: 32px; border: 1px solid transparent; background: transparent; color: #64746a; }
        .review-preview { padding-bottom: 13px; border-color: #d9e8d9; }
        .review-preview-list { display: grid; max-height: 210px; overflow-y: auto; padding: 0 19px; }
        .review-preview-list > div { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 9px 0; border-top: 1px solid #edf1ec; }
        .review-preview-list strong { overflow: hidden; color: #435748; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
        .review-preview-list span { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 5px; color: #28734b; font-size: 10px; font-weight: 700; }
        .review-preview-footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 19px 0; color: #859187; font-size: 9px; }
        .review-feedback { margin: -3px 2px 0; color: #426d4c; font-size: 10px; line-height: 1.5; }
        .review-footnote { display: flex; align-items: flex-start; gap: 7px; margin: 0 2px; color: #8d978f; font-size: 9px; line-height: 1.55; }
        .review-footnote :global(svg) { flex: 0 0 auto; margin-top: 1px; color: #b17a31; }
        .review-empty { padding: 30px 18px; color: #88948b; font-size: 11px; text-align: center; }
        @media (max-width: 900px) {
          .review-hero { align-items: flex-start; flex-direction: column; }
          .review-hero-stats { width: 100%; }
          .review-hero-stats span { flex: 1; }
          .review-settings { grid-template-columns: 1fr 1fr; }
          .review-rule { grid-column: 1 / -1; }
          .review-table-heading { flex-direction: column; }
          .review-actions { width: 100%; }
          .review-search { flex: 1; }
        }
        @media (max-width: 560px) {
          .admin-margin-review { gap: 10px; }
          .review-hero { gap: 14px; padding: 17px; border-radius: 14px; }
          .review-hero-stats span { min-width: 0; }
          .review-card-heading { align-items: flex-start; padding: 14px; }
          .review-settings { grid-template-columns: 1fr 1fr; gap: 10px; padding: 0 14px 14px; }
          .review-settings label { min-width: 0; font-size: 9px; }
          .review-table-heading { gap: 11px; }
          .review-actions { align-items: stretch; }
          .review-filter { max-width: 132px; }
          .review-table { min-width: 810px; }
          .review-table-footer { align-items: flex-start; flex-direction: column; padding: 11px 14px; }
          .review-table-footer > div { width: 100%; justify-content: flex-end; }
          .review-preview-footer { align-items: flex-start; flex-direction: column; padding-right: 14px; padding-left: 14px; }
          .review-preview-footer .review-primary { align-self: stretch; }
        }
      `}</style>
    </section>
  );
}
