export const formatCurrency = (value: number, compact = false) => new Intl.NumberFormat(compact ? "pt-PT" : "de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: compact ? 0 : 2,
  notation: compact ? "compact" : "standard",
}).format(value);

export const formatNumber = (value: number) => new Intl.NumberFormat("pt-PT").format(value);

export const formatDate = (value: string) => new Intl.DateTimeFormat("pt-PT", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
}).format(new Date(value));

export const initials = (name: string) => name.split(" ").map((part) => part[0]).slice(0, 2).join("");
