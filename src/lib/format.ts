export const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function formatMoney(amount: number): string {
  return currency.format(Number.isFinite(amount) ? amount : 0);
}

export function csvCell(value: string | number): string {
  const text = String(value);
  const safeText = typeof value === "string" && /^[\s]*[=+\-@]/.test(value) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

export function formatDateTime(timestamp: number): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function formatShortDate(timestamp: number): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(timestamp));
}

export function startOfLocalDay(timestamp = Date.now()): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
