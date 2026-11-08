"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, PackageSearch } from "lucide-react";
import type { Invoice, OperationsRecord, Product } from "@/lib/db";
import { csvCell, formatMoney } from "@/lib/format";

function exportRestock(rows: { name: string; category: string; unit: string; onHand: number; sold: number; daysCover: number | null; suggested: number; estimate: number }[]) {
  const contents = [
    ["Product", "Category", "Unit", "On hand", "Sold in 30 days", "Estimated days cover", "Suggested order", "Estimated cost"],
    ...rows.map((row) => [row.name, row.category, row.unit, row.onHand, row.sold, row.daysCover === null ? "N/A" : row.daysCover.toFixed(1), row.suggested, row.estimate]),
  ].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${contents}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `kokan-restock-plan-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function RestockPlanner({ products, invoices, operations }: { products: Product[]; invoices: Invoice[]; operations: OperationsRecord[] }) {
  const [asOf, setAsOf] = useState<number | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setAsOf(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const recommendations = useMemo(() => {
    if (asOf === null) return null;
    const period = 30 * 24 * 60 * 60 * 1000;
    const cutoff = asOf - period;
    const demand = new Map<string, number>();
    for (const invoice of invoices) {
      if (invoice.createdAt < cutoff || invoice.createdAt > asOf) continue;
      for (const item of invoice.items) demand.set(item.productId, (demand.get(item.productId) ?? 0) + item.quantity);
    }
    for (const operation of operations) {
      if (operation.createdAt < cutoff || operation.createdAt > asOf || operation.payload.kind !== "return") continue;
      demand.set(operation.payload.productId, (demand.get(operation.payload.productId) ?? 0) - operation.payload.quantity);
    }
    return products.map((product) => {
      const sold = Math.max(0, demand.get(product.id) ?? 0);
      const dailyDemand = sold / 30;
      const suggested = dailyDemand > 0 ? Math.max(0, Math.ceil(dailyDemand * 14 - product.stockQty)) : 0;
      return {
        id: product.id,
        name: product.name,
        category: product.category,
        unit: product.unit,
        onHand: product.stockQty,
        sold,
        daysCover: dailyDemand > 0 ? product.stockQty / dailyDemand : null,
        suggested,
        estimate: suggested * product.costPrice,
      };
    }).filter((product) => product.suggested > 0).sort((a, b) =>
      (a.daysCover ?? Number.POSITIVE_INFINITY) - (b.daysCover ?? Number.POSITIVE_INFINITY) || b.suggested - a.suggested,
    );
  }, [asOf, invoices, operations, products]);

  if (!recommendations) {
    return <section className="data-card restock-planner"><div className="data-card-toolbar"><div><h3>Restock planner</h3><span>Preparing demand-based stock suggestions…</span></div></div></section>;
  }

  const totalUnits = recommendations.reduce((sum, product) => sum + product.suggested, 0);
  const totalCost = recommendations.reduce((sum, product) => sum + product.estimate, 0);
  return (
    <section className="data-card restock-planner">
      <div className="data-card-toolbar">
        <div><h3>14-day restock planner</h3><span>Suggested quantities from the last 30 days of sales and returns.</span></div>
        <button className="button button-secondary restock-export" onClick={() => exportRestock(recommendations)} disabled={!recommendations.length}><Download size={14} /> Export plan</button>
      </div>
      {recommendations.length ? (
        <>
          <div className="restock-summary"><span><strong>{recommendations.length}</strong> products to review</span><span><strong>{totalUnits}</strong> total units suggested</span><span>Estimated cost <strong>{formatMoney(totalCost)}</strong></span></div>
          <div className="restock-list">
            {recommendations.slice(0, 8).map((product) => (
              <div className="restock-row" key={product.id}>
                <span className="restock-product"><strong>{product.name}</strong><small>{product.category} · {product.sold} sold / 30d</small></span>
                <span className="restock-coverage"><strong>{product.daysCover?.toFixed(0) ?? "—"} days</strong><small>{product.onHand} {product.unit} on hand</small></span>
                <span className="restock-suggested"><strong>+{product.suggested} {product.unit}</strong><small>{formatMoney(product.estimate)} at cost</small></span>
              </div>
            ))}
            {recommendations.length > 8 && <span className="restock-more">Export the plan to see {recommendations.length - 8} more products.</span>}
          </div>
        </>
      ) : (
        <div className="restock-empty"><PackageSearch size={20} /><span>No demand-based replenishment suggestions right now.</span></div>
      )}
      <p className="restock-disclaimer">A planning estimate, not a purchase order. Check supplier pack sizes and seasonality before ordering. Uses sales stored on this device.</p>
    </section>
  );
}
