"use client";

import { useMemo, useState, type FormEvent } from "react";
import { ArrowDownUp, Banknote, ClipboardList, Download, PackagePlus, ReceiptText, RotateCcw, Wallet } from "lucide-react";
import type { Customer, Invoice, OperationsPayload, OperationsRecord, Product } from "@/lib/db";
import { csvCell, formatDateTime, formatMoney } from "@/lib/format";

type OperationKind = OperationsPayload["kind"];

function downloadCsv(rows: (string | number)[][], name: string) {
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function operationSummary(record: OperationsRecord): string {
  const payload = record.payload;
  switch (payload.kind) {
    case "stock_adjustment":
      return `${payload.productName} · ${payload.quantityDelta > 0 ? "+" : ""}${payload.quantityDelta} · ${payload.reason}`;
    case "purchase":
      return `${payload.productName} · ${payload.quantity} units from ${payload.supplier} · ${formatMoney(payload.total)}`;
    case "expense":
      return `${payload.category} · ${payload.description} · ${formatMoney(payload.amount)}`;
    case "return":
      return `${payload.productName} × ${payload.quantity} · invoice ${payload.invoiceNumber} · ${formatMoney(payload.amount)} refund`;
    case "customer_payment":
      return `${payload.customerName} paid ${formatMoney(payload.amount)}${payload.note ? ` · ${payload.note}` : ""}`;
    case "cash_close":
      return `Cash close · expected ${formatMoney(payload.expectedCash)} · counted ${formatMoney(payload.countedCash)} · variance ${formatMoney(payload.variance)}`;
  }
}

export function OperationsView({
  products,
  customers,
  invoices,
  operations,
  onStockAdjustment,
  onReceivePurchase,
  onExpense,
  onReturn,
  onCustomerPayment,
  onCashClose,
}: {
  products: Product[];
  customers: Customer[];
  invoices: Invoice[];
  operations: OperationsRecord[];
  onStockAdjustment: (productId: string, newQuantity: number, reason: string) => Promise<boolean>;
  onReceivePurchase: (productId: string, supplier: string, quantity: number, unitCost: number, note: string) => Promise<boolean>;
  onExpense: (category: string, amount: number, description: string, paymentMode: "cash" | "upi") => Promise<boolean>;
  onReturn: (invoiceId: string, productId: string, quantity: number) => Promise<boolean>;
  onCustomerPayment: (customerId: string, amount: number, note: string) => Promise<boolean>;
  onCashClose: (openingFloat: number, countedCash: number, expectedCash: number) => Promise<boolean>;
}) {
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [countedStock, setCountedStock] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("Stock count");
  const [supplier, setSupplier] = useState("");
  const [purchaseQuantity, setPurchaseQuantity] = useState("1");
  const [purchaseCost, setPurchaseCost] = useState("");
  const [purchaseNote, setPurchaseNote] = useState("");
  const [expenseCategory, setExpenseCategory] = useState("Utilities");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expensePaymentMode, setExpensePaymentMode] = useState<"cash" | "upi">("cash");
  const [returnInvoiceId, setReturnInvoiceId] = useState(invoices[0]?.id ?? "");
  const [returnProductId, setReturnProductId] = useState("");
  const [returnQuantity, setReturnQuantity] = useState("1");
  const [paymentCustomerId, setPaymentCustomerId] = useState(customers.find((customer) => customer.currentBalance > 0)?.id ?? "");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [openingFloat, setOpeningFloat] = useState("0");
  const [countedCash, setCountedCash] = useState("");
  const [filter, setFilter] = useState<"all" | OperationKind>("all");

  const selectedProduct = products.find((product) => product.id === productId);
  const selectedInvoice = invoices.find((invoice) => invoice.id === returnInvoiceId);
  const selectedCustomer = customers.find((customer) => customer.id === paymentCustomerId);
  const returnedQuantities = useMemo(() => {
    const quantities = new Map<string, number>();
    for (const operation of operations) {
      if (operation.payload.kind !== "return") continue;
      const key = `${operation.payload.invoiceId}:${operation.payload.productId}`;
      quantities.set(key, (quantities.get(key) ?? 0) + operation.payload.quantity);
    }
    return quantities;
  }, [operations]);
  const returnItems = (selectedInvoice?.items ?? []).map((item) => ({
    ...item,
    available: Math.max(0, item.quantity - (returnedQuantities.get(`${selectedInvoice?.id}:${item.productId}`) ?? 0)),
  })).filter((item) => item.available > 0);
  const returnItem = returnItems.find((item) => item.productId === returnProductId) ?? returnItems[0];
  const todayKey = new Date().toLocaleDateString("en-CA");
  const todayInvoices = invoices.filter((invoice) => new Date(invoice.createdAt).toLocaleDateString("en-CA") === todayKey);
  const todayOperations = operations.filter((operation) => new Date(operation.createdAt).toLocaleDateString("en-CA") === todayKey);
  const cashSales = todayInvoices.filter((invoice) => invoice.paymentMode === "cash").reduce((sum, invoice) => sum + invoice.totalAmount, 0);
  const cashReturns = todayOperations.filter((operation) => operation.payload.kind === "return" && operation.payload.paymentMode === "cash")
    .reduce((sum, operation) => sum + (operation.payload.kind === "return" ? operation.payload.amount : 0), 0);
  const cashExpenses = todayOperations.filter((operation) => operation.payload.kind === "expense" && operation.payload.paymentMode === "cash")
    .reduce((sum, operation) => sum + (operation.payload.kind === "expense" ? operation.payload.amount : 0), 0);
  const expectedCash = Math.max(0, (Number(openingFloat) || 0) + cashSales - cashReturns - cashExpenses);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const thisMonth = operations.filter((operation) => operation.createdAt >= monthStart.getTime());
  const monthExpenses = thisMonth.filter((operation) => operation.payload.kind === "expense").reduce((sum, operation) => sum + (operation.payload.kind === "expense" ? operation.payload.amount : 0), 0);
  const monthPurchases = thisMonth.filter((operation) => operation.payload.kind === "purchase").reduce((sum, operation) => sum + (operation.payload.kind === "purchase" ? operation.payload.total : 0), 0);
  const monthReturns = thisMonth.filter((operation) => operation.payload.kind === "return").reduce((sum, operation) => sum + (operation.payload.kind === "return" ? operation.payload.amount : 0), 0);
  const visibleOperations = operations.filter((operation) => filter === "all" || operation.payload.kind === filter);

  const submit = (handler: () => Promise<void>) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void handler();
  };
  const exportOperations = () => downloadCsv([
    ["Date", "Type", "Details", "Amount", "Sync status"],
    ...visibleOperations.map((operation) => [
      formatDateTime(operation.createdAt),
      operation.payload.kind,
      operationSummary(operation),
      operation.payload.kind === "expense" ? operation.payload.amount
        : operation.payload.kind === "purchase" ? operation.payload.total
          : operation.payload.kind === "return" ? operation.payload.amount
            : operation.payload.kind === "customer_payment" ? operation.payload.amount
              : "",
      operation.synced ? "Synced" : "Queued",
    ]),
  ], "kokan-pos-operations");

  return (
    <section className="admin-page operations-page">
      <div className="page-action-row"><div><span className="section-eyebrow">KEEP EVERYDAY OPERATIONS IN ORDER</span><h2>Shop operations</h2></div><button className="button button-secondary" onClick={exportOperations} disabled={!visibleOperations.length}><Download size={15} /> Export activity</button></div>
      <div className="metric-grid four-metrics">
        <MetricCardLite label="Expenses this month" value={formatMoney(monthExpenses)} detail="Recorded shop costs" />
        <MetricCardLite label="Purchases this month" value={formatMoney(monthPurchases)} detail="Stock received" />
        <MetricCardLite label="Returns this month" value={formatMoney(monthReturns)} detail="Refunds recorded" />
        <MetricCardLite label="Cash expected today" value={formatMoney(expectedCash)} detail={`${formatMoney(cashSales)} cash sales less cash returns and expenses`} />
      </div>

      <div className="operations-grid">
        <section className="data-card operations-card">
          <div className="settings-card-heading"><div className="settings-card-icon settings-icon-blue"><ArrowDownUp size={17} /></div><div><h3>Stock count adjustment</h3><p>Set an actual shelf count and keep a reasoned audit entry.</p></div></div>
          <form onSubmit={submit(async () => {
            const quantity = Number(countedStock);
            if (!selectedProduct || !Number.isFinite(quantity) || quantity < 0 || !adjustmentReason.trim()) return;
            if (await onStockAdjustment(selectedProduct.id, quantity, adjustmentReason.trim())) setCountedStock("");
          })}>
            <label className="form-label">PRODUCT<select className="form-input" value={productId} onChange={(event) => setProductId(event.target.value)} required>{products.map((product) => <option value={product.id} key={product.id}>{product.name} · current {product.stockQty}</option>)}</select></label>
            <div className="form-two-columns"><label className="form-label">COUNTED QUANTITY<input className="form-input" type="number" min="0" step="any" value={countedStock} onChange={(event) => setCountedStock(event.target.value)} required /></label><label className="form-label">REASON<select className="form-input" value={adjustmentReason} onChange={(event) => setAdjustmentReason(event.target.value)}><option>Stock count</option><option>Damaged goods</option><option>Expired goods</option><option>Correction</option></select></label></div>
            <button className="button button-primary" type="submit" disabled={!selectedProduct || countedStock === ""}><ArrowDownUp size={14} /> Save adjustment</button>
          </form>
        </section>

        <section className="data-card operations-card">
          <div className="settings-card-heading"><div className="settings-card-icon settings-icon-green"><PackagePlus size={17} /></div><div><h3>Receive a supplier purchase</h3><p>Add received quantities and refresh the item&apos;s cost price.</p></div></div>
          <form onSubmit={submit(async () => {
            const quantity = Number(purchaseQuantity);
            const cost = Number(purchaseCost);
            if (!selectedProduct || !supplier.trim() || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(cost) || cost < 0) return;
            if (await onReceivePurchase(selectedProduct.id, supplier.trim(), quantity, cost, purchaseNote.trim())) {
              setPurchaseQuantity("1");
              setPurchaseNote("");
            }
          })}>
            <label className="form-label">SUPPLIER<input className="form-input" value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder="Supplier or distributor" required /></label>
            <label className="form-label">PRODUCT<select className="form-input" value={productId} onChange={(event) => { setProductId(event.target.value); setPurchaseCost(String(products.find((product) => product.id === event.target.value)?.costPrice ?? "")); }} required>{products.map((product) => <option value={product.id} key={product.id}>{product.name}</option>)}</select></label>
            <div className="form-two-columns"><label className="form-label">QUANTITY<input className="form-input" type="number" min="0.001" step="any" value={purchaseQuantity} onChange={(event) => setPurchaseQuantity(event.target.value)} required /></label><label className="form-label">UNIT COST<input className="form-input" type="number" min="0" step="0.01" value={purchaseCost} onChange={(event) => setPurchaseCost(event.target.value)} required /></label></div>
            <label className="form-label">REFERENCE / NOTE<input className="form-input" value={purchaseNote} onChange={(event) => setPurchaseNote(event.target.value)} placeholder="Optional invoice number" /></label>
            <button className="button button-primary" type="submit" disabled={!products.length}><PackagePlus size={14} /> Receive {formatMoney((Number(purchaseQuantity) || 0) * (Number(purchaseCost) || 0))}</button>
          </form>
        </section>

        <section className="data-card operations-card">
          <div className="settings-card-heading"><div className="settings-card-icon settings-icon-orange"><Wallet size={17} /></div><div><h3>Record an expense</h3><p>Separate cash and UPI costs for accurate day closing.</p></div></div>
          <form onSubmit={submit(async () => {
            const amount = Number(expenseAmount);
            if (!Number.isFinite(amount) || amount <= 0 || !expenseDescription.trim()) return;
            if (await onExpense(expenseCategory, amount, expenseDescription.trim(), expensePaymentMode)) {
              setExpenseAmount("");
              setExpenseDescription("");
            }
          })}>
            <div className="form-two-columns"><label className="form-label">CATEGORY<select className="form-input" value={expenseCategory} onChange={(event) => setExpenseCategory(event.target.value)}><option>Utilities</option><option>Rent</option><option>Transport</option><option>Packaging</option><option>Repairs</option><option>Other</option></select></label><label className="form-label">PAID USING<select className="form-input" value={expensePaymentMode} onChange={(event) => setExpensePaymentMode(event.target.value as "cash" | "upi")}><option value="cash">Cash</option><option value="upi">UPI / bank</option></select></label></div>
            <label className="form-label">AMOUNT<input className="form-input" type="number" min="0.01" step="0.01" value={expenseAmount} onChange={(event) => setExpenseAmount(event.target.value)} required /></label>
            <label className="form-label">DESCRIPTION<input className="form-input" value={expenseDescription} onChange={(event) => setExpenseDescription(event.target.value)} placeholder="What was this expense for?" required /></label>
            <button className="button button-primary" type="submit"><Wallet size={14} /> Save expense</button>
          </form>
        </section>

        <section className="data-card operations-card">
          <div className="settings-card-heading"><div className="settings-card-icon settings-icon-purple"><RotateCcw size={17} /></div><div><h3>Record a return</h3><p>Restores stock and adjusts Khata; send cash or UPI refunds separately.</p></div></div>
          <form onSubmit={submit(async () => {
            const quantity = Number(returnQuantity);
            if (!selectedInvoice || !returnItem || !Number.isInteger(quantity) || quantity < 1 || quantity > returnItem.available) return;
            if (await onReturn(selectedInvoice.id, returnItem.productId, quantity)) setReturnQuantity("1");
          })}>
            <label className="form-label">ORIGINAL RECEIPT<select className="form-input" value={returnInvoiceId} onChange={(event) => { setReturnInvoiceId(event.target.value); setReturnProductId(""); }} required><option value="">Select a sale</option>{invoices.map((invoice) => <option value={invoice.id} key={invoice.id}>{formatDateTime(invoice.createdAt)} · {invoice.customerName ?? "Walk-in"} · {formatMoney(invoice.totalAmount)}</option>)}</select></label>
            <label className="form-label">ITEM TO RETURN<select className="form-input" value={returnItem?.productId ?? ""} onChange={(event) => setReturnProductId(event.target.value)} required>{returnItems.map((item) => <option value={item.productId} key={item.productId}>{item.name} · {item.available} remaining</option>)}</select></label>
            <label className="form-label">QUANTITY<input className="form-input" type="number" min="1" max={returnItem?.available ?? 1} step="1" value={returnQuantity} onChange={(event) => setReturnQuantity(event.target.value)} required /></label>
            <button className="button button-primary" type="submit" disabled={!returnItem || !selectedInvoice}><RotateCcw size={14} /> Process return</button>
          </form>
        </section>

        <section className="data-card operations-card">
          <div className="settings-card-heading"><div className="settings-card-icon settings-icon-blue"><Banknote size={17} /></div><div><h3>Settle a customer balance</h3><p>Record a payment and reduce the customer&apos;s Khata due.</p></div></div>
          <form onSubmit={submit(async () => {
            const amount = Number(paymentAmount);
            if (!selectedCustomer || !Number.isFinite(amount) || amount <= 0 || amount > selectedCustomer.currentBalance) return;
            if (await onCustomerPayment(selectedCustomer.id, amount, paymentNote.trim())) {
              setPaymentAmount("");
              setPaymentNote("");
            }
          })}>
            <label className="form-label">CUSTOMER<select className="form-input" value={paymentCustomerId} onChange={(event) => setPaymentCustomerId(event.target.value)} required><option value="">Choose customer</option>{customers.filter((customer) => customer.currentBalance > 0).map((customer) => <option value={customer.id} key={customer.id}>{customer.name} · due {formatMoney(customer.currentBalance)}</option>)}</select></label>
            <label className="form-label">PAYMENT AMOUNT<input className="form-input" type="number" min="0.01" max={selectedCustomer?.currentBalance ?? undefined} step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} required /></label>
            <label className="form-label">NOTE<input className="form-input" value={paymentNote} onChange={(event) => setPaymentNote(event.target.value)} placeholder="Optional receipt or reference" /></label>
            <button className="button button-primary" type="submit" disabled={!selectedCustomer}><Banknote size={14} /> Record collection</button>
          </form>
        </section>

        <section className="data-card operations-card">
          <div className="settings-card-heading"><div className="settings-card-icon settings-icon-orange"><ReceiptText size={17} /></div><div><h3>Close today&apos;s cash drawer</h3><p>Compare counted cash with the till&apos;s expected cash balance.</p></div></div>
          <form onSubmit={submit(async () => {
            const opening = Number(openingFloat);
            const counted = Number(countedCash);
            if (!Number.isFinite(opening) || opening < 0 || !Number.isFinite(counted) || counted < 0) return;
            if (await onCashClose(opening, counted, expectedCash)) setCountedCash("");
          })}>
            <div className="form-two-columns"><label className="form-label">OPENING FLOAT<input className="form-input" type="number" min="0" step="0.01" value={openingFloat} onChange={(event) => setOpeningFloat(event.target.value)} required /></label><label className="form-label">COUNTED CASH<input className="form-input" type="number" min="0" step="0.01" value={countedCash} onChange={(event) => setCountedCash(event.target.value)} required /></label></div>
            <div className="operations-cash-summary"><span>Expected cash today</span><strong>{formatMoney(expectedCash)}</strong><small>Cash sales − cash refunds − cash expenses + opening float</small></div>
            <button className="button button-primary" type="submit"><ClipboardList size={14} /> Save cash close</button>
          </form>
        </section>
      </div>

      <section className="data-card operations-history">
        <div className="data-card-toolbar"><div><h3>Operations history</h3><span>{visibleOperations.length} local-first entries · sync status shown for each record</span></div><label className="form-label">FILTER<select className="form-input" value={filter} onChange={(event) => setFilter(event.target.value as "all" | OperationKind)}><option value="all">All activity</option><option value="stock_adjustment">Stock adjustments</option><option value="purchase">Purchases</option><option value="expense">Expenses</option><option value="return">Returns</option><option value="customer_payment">Khata collections</option><option value="cash_close">Cash closes</option></select></label></div>
        <div className="operations-history-list">{visibleOperations.slice(0, 150).map((operation) => <article className="operations-history-row" key={operation.id}><div><strong>{operation.payload.kind.replaceAll("_", " ")}</strong><span>{operationSummary(operation)}</span></div><time>{formatDateTime(operation.createdAt)}</time><span className={`sync-status ${operation.synced ? "sync-status-done" : "sync-status-pending"}`}><span />{operation.synced ? "Synced" : "Queued"}</span></article>)}
          {!visibleOperations.length && <div className="table-empty"><ClipboardList size={22} /><strong>No operations recorded yet</strong><span>Purchases, expenses, returns, collections, and stock counts will appear here.</span></div>}
        </div>
      </section>
    </section>
  );
}

function MetricCardLite({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="metric-card"><span className="metric-label">{label}</span><strong className="metric-value">{value}</strong><small className="metric-detail">{detail}</small></article>;
}
