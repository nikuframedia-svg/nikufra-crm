const currencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const decimalFormatter = new Intl.NumberFormat("pt-PT", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export const formatCurrency = (value: number) => currencyFormatter.format(value);

export const formatDecimal = (value: number) => decimalFormatter.format(value);

export const formatPercentage = (value: number) => `${formatDecimal(value)}%`;

export const formatNumber = (value: number) => new Intl.NumberFormat("pt-PT").format(value);

export const formatDate = (value: string) => new Intl.DateTimeFormat("pt-PT", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
}).format(new Date(value));

export const initials = (name: string) => name.split(" ").map((part) => part[0]).slice(0, 2).join("");
