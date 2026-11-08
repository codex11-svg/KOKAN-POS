"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Lightbulb, TrendingDown, TrendingUp } from "lucide-react";
import type { Customer, Invoice, OperationsRecord, Product } from "@/lib/db";
import { csvCell, formatMoney } from "@/lib/format";

type PeriodDays = 7 | 30 | 90;

function downloadCsv(rows: (string | number)[][]) {
  const contents = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${contents}`], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `kokan-owner-insights-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function OwnerInsights({
  invoices,
  products,
  operations,
}: {
  invoices: Invoice[];
  products: Product[];
  operations: OperationsRecord[];
}) {
  const [period, setPeriod] = useState<PeriodDays>(30);
  const [asOf, setAsOf] = useState<number | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setAsOf(Date.now()), 0);
    return () => window.clearTimeout(timer);
  }, []);
  const insights = useMemo(() => {
    if (asOf === null) return null;
    const now = asOf;
    const start = now - period * 24 * 60 * 60 * 1000;
    const previousStart = start - period * 24 * 60 * 60 * 1000;
    const currentInvoices = invoices.filter((invoice) => invoice.createdAt >= start && invoice.createdAt <= now);
    const previousInvoices = invoices.filter((invoice) => invoice.createdAt >= previousStart && invoice.createdAt < start);
    const currentOperations = operations.filter((operation) => operation.createdAt >= start && operation.createdAt <= now);
    const previousOperations = operations.filter((operation) => operation.createdAt >= previousStart && operation.createdAt < start);
    const currentReturns = currentOperations.filter((operation) => operation.payload.kind === "return");
    const previousRefundTotal = previousOperations.reduce((sum, operation) =>
      sum + (operation.payload.kind === "return" ? operation.payload.amount : 0), 0);
    const currentExpenses = currentOperations.filter((operation) => operation.payload.kind === "expense");
    const refundTotal = currentReturns.reduce((sum, operation) => sum + (operation.payload.kind === "return" ? operation.payload.amount : 0), 0);
    const profitReversal = currentReturns.reduce((sum, operation) => sum + (operation.payload.kind === "return" ? operation.payload.profitReversal : 0), 0);
    const expenseTotal = currentExpenses.reduce((sum, operation) => sum + (operation.payload.kind === "expense" ? operation.payload.amount : 0), 0);
    const expenseCategories = new Map<string, number>();
    for (const operation of currentExpenses) {
      if (operation.payload.kind !== "expense") continue;
      expenseCategories.set(operation.payload.category, (expenseCategories.get(operation.payload.category) ?? 0) + operation.payload.amount);
    }

    const netSales = currentInvoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0) - refundTotal;
    const previousSales = previousInvoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0) - previousRefundTotal;
    const grossProfit = currentInvoices.reduce((sum, invoice) =>
      sum + invoice.items.reduce((itemSum, item) => itemSum + (item.unitPrice - item.unitCost) * item.quantity, 0) - invoice.discount, 0,
    ) - profitReversal;
    const discounts = currentInvoices.reduce((sum, invoice) => sum + invoice.discount, 0);
    const subtotal = currentInvoices.reduce((sum, invoice) => sum + invoice.subtotal, 0);
    const productSales = new Map<string, { name: string; quantity: number; profit: number }>();
    const categorySales = new Map<string, { revenue: number; profit: number }>();
    const soldProductIds = new Set<string>();
    const customerVisits = new Map<string, number>();
    const hourSales = new Map<number, number>();
    for (const invoice of currentInvoices) {
      if (invoice.customerId) customerVisits.set(invoice.customerId, (customerVisits.get(invoice.customerId) ?? 0) + 1);
      hourSales.set(new Date(invoice.createdAt).getHours(), (hourSales.get(new Date(invoice.createdAt).getHours()) ?? 0) + invoice.totalAmount);
      for (const item of invoice.items) {
        soldProductIds.add(item.productId);
        const discountShare = invoice.subtotal > 0 ? invoice.discount * item.lineTotal / invoice.subtotal : 0;
        const itemProfit = (item.unitPrice - item.unitCost) * item.quantity - discountShare;
        const product = productSales.get(item.productId) ?? { name: item.name, quantity: 0, profit: 0 };
        product.quantity += item.quantity;
        product.profit += itemProfit;
        productSales.set(item.productId, product);
        const category = categorySales.get(item.category) ?? { revenue: 0, profit: 0 };
        category.revenue += item.lineTotal - discountShare;
        category.profit += itemProfit;
        categorySales.set(item.category, category);
      }
    }
    const repeatCustomers = Array.from(customerVisits.values()).filter((visits) => visits > 1).length;
    const identifiedCustomers = customerVisits.size;
    const bestHour = Array.from(hourSales.entries()).sort((a, b) => b[1] - a[1])[0];
    const bestProduct = Array.from(productSales.values()).sort((a, b) => b.profit - a.profit)[0];
    const topCategory = Array.from(categorySales.entries()).sort((a, b) => b[1].profit - a[1].profit)[0];
    const quietStockItems = products.filter((product) => product.stockQty > 0 && !soldProductIds.has(product.id));
    const quietStock = quietStockItems.slice(0, 5);
    const stockAtCost = products.reduce((sum, product) => sum + product.costPrice * product.stockQty, 0);
    const changePercent = previousSales > 0 ? ((netSales - previousSales) / previousSales) * 100 : null;
    const moneyPerSale = currentInvoices.length ? netSales / currentInvoices.length : 0;
    const periodLabel = `Last ${period} days`;
    const bestHourLabel = bestHour
      ? new Intl.DateTimeFormat("en", { hour: "numeric", hour12: true }).format(new Date(2000, 0, 1, bestHour[0]))
      : "No sales yet";

    return {
      currentInvoices,
      netSales,
      previousSales,
      changePercent,
      grossProfit,
      operatingEstimate: grossProfit - expenseTotal,
      expenseTotal,
      discounts,
      discountPercent: subtotal > 0 ? discounts / subtotal * 100 : 0,
      moneyPerSale,
      repeatRate: identifiedCustomers ? repeatCustomers / identifiedCustomers * 100 : 0,
      identifiedCustomers,
      bestHourLabel,
      bestHourSales: bestHour?.[1] ?? 0,
      bestProduct,
      topCategory,
      quietStock,
      quietStockCount: quietStockItems.length,
      stockAtCost,
      expenseCategories: Array.from(expenseCategories.entries()).sort((a, b) => b[1] - a[1]),
      periodLabel,
    };
  }, [asOf, invoices, operations, period, products]);

  const exportInsights = () => {
    if (!insights) return;
    downloadCsv([
    ["Owner insight", "Value", "Period"],
    ["Net sales", insights.netSales, insights.periodLabel],
    ["Sales in previous period", insights.previousSales, `Previous ${period} days`],
    ["Sales change percent", insights.changePercent === null ? "N/A" : insights.changePercent.toFixed(1), insights.periodLabel],
    ["Estimated gross profit", insights.grossProfit, insights.periodLabel],
    ["Estimated operating result", insights.operatingEstimate, insights.periodLabel],
    ["Recorded expenses", insights.expenseTotal, insights.periodLabel],
    ["Discounts", insights.discounts, insights.periodLabel],
    ["Discount percent of subtotal", insights.discountPercent.toFixed(1), insights.periodLabel],
    ["Average sale", insights.moneyPerSale, insights.periodLabel],
    ["Repeat customer rate percent", insights.repeatRate.toFixed(1), insights.periodLabel],
    ["Busiest sales hour", insights.bestHourLabel, insights.periodLabel],
    ["Top profit product", insights.bestProduct?.name ?? "N/A", insights.periodLabel],
    ["Top profit category", insights.topCategory?.[0] ?? "N/A", insights.periodLabel],
    ["Quiet in-stock product count", insights.quietStockCount, insights.periodLabel],
    ["Inventory at cost", insights.stockAtCost, "Current"],
    ...insights.expenseCategories.map(([category, amount]) => [`Expense: ${category}`, amount, insights.periodLabel]),
    ]);
  };

  if (!insights) return <section className="data-card owner-insights-card"><div className="data-card-toolbar"><div><h3>Owner insights</h3><span>Preparing your sales and stock summary…</span></div></div></section>;
  const trendUp = insights.changePercent !== null && insights.changePercent >= 0;
  return (
    <section className="data-card owner-insights-card">
      <div className="data-card-toolbar owner-insights-toolbar">
        <div><h3>Owner insights</h3><span>Trading signals from your local sales and stock history.</span></div>
        <div className="owner-insights-actions">
          <label className="owner-period-select"><span className="sr-only">Insight period</span><select value={period} onChange={(event) => setPeriod(Number(event.target.value) as PeriodDays)}><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select></label>
          <button className="button button-secondary owner-insights-export" onClick={exportInsights}><Download size={14} /> Export</button>
        </div>
      </div>
      <div className="owner-insight-grid">
        <article className="owner-insight"><span>Net sales · {insights.periodLabel}</span><strong>{formatMoney(insights.netSales)}</strong><small>{insights.changePercent === null ? "No previous-period sales to compare" : <>{trendUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {Math.abs(insights.changePercent).toFixed(1)}% vs previous {period} days</>}</small></article>
        <article className="owner-insight"><span>Estimated gross profit</span><strong>{formatMoney(insights.grossProfit)}</strong><small>Product margin less recorded discounts and returns</small></article>
        <article className="owner-insight"><span>Estimated after expenses</span><strong>{formatMoney(insights.operatingEstimate)}</strong><small>{formatMoney(insights.expenseTotal)} recorded expenses in range</small></article>
        <article className="owner-insight"><span>Average sale</span><strong>{formatMoney(insights.moneyPerSale)}</strong><small>{insights.currentInvoices.length} completed tickets</small></article>
        <article className="owner-insight"><span>Repeat customer rate</span><strong>{insights.repeatRate.toFixed(0)}%</strong><small>{insights.identifiedCustomers} identified customers with sales</small></article>
        <article className="owner-insight"><span>Discount share</span><strong>{insights.discountPercent.toFixed(1)}%</strong><small>{formatMoney(insights.discounts)} discount on recorded subtotal</small></article>
        <article className="owner-insight"><span>Busiest sales hour</span><strong>{insights.bestHourLabel}</strong><small>{formatMoney(insights.bestHourSales)} in sales during that hour</small></article>
        <article className="owner-insight"><span>Top profit product</span><strong>{insights.bestProduct?.name ?? "Not enough data"}</strong><small>{insights.bestProduct ? `${insights.bestProduct.quantity} units · ${formatMoney(insights.bestProduct.profit)} estimated gross profit` : "Sales will appear here as tickets are recorded."}</small></article>
        <article className="owner-insight"><span>Top profit category</span><strong>{insights.topCategory?.[0] ?? "Not enough data"}</strong><small>{insights.topCategory ? `${formatMoney(insights.topCategory[1].revenue)} sales · ${formatMoney(insights.topCategory[1].profit)} estimated gross profit` : "Category sales will appear here."}</small></article>
        <article className="owner-insight"><span>Inventory at cost</span><strong>{formatMoney(insights.stockAtCost)}</strong><small>Current stock valuation using recorded cost prices</small></article>
      </div>
      <div className="owner-insight-lists">
        <div><strong><Lightbulb size={14} /> In stock, no sales in range</strong>{insights.quietStock.length ? <>{insights.quietStock.map((product) => <span key={product.id}>{product.name} · {product.stockQty} {product.unit}</span>)}{insights.quietStockCount > insights.quietStock.length && <span>And {insights.quietStockCount - insights.quietStock.length} more.</span>}</> : <span>No unsold in-stock items in this range.</span>}</div>
        <div><strong><Lightbulb size={14} /> Expense breakdown</strong>{insights.expenseCategories.length ? insights.expenseCategories.map(([category, amount]) => <span key={category}>{category} · {formatMoney(amount)}</span>) : <span>No expenses recorded in this range.</span>}</div>
      </div>
      <p className="owner-insight-disclaimer">Estimates use only sales and operations stored on this device. Product margin and operating results are not audited accounting or tax figures.</p>
    </section>
  );
}
