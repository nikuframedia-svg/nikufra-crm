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

export function parseMoneyInput(value: string) {
  const cleaned = value.trim().replace(/[€\s\u00a0]/g, "").replace(/[^0-9,.-]/g, "");
  if (!cleaned) return Number.NaN;
  const negative = cleaned.startsWith("-");
  const unsigned = cleaned.replace(/-/g, "");
  const comma = unsigned.lastIndexOf(",");
  const dot = unsigned.lastIndexOf(".");
  let normalized: string;

  if (comma >= 0 && dot >= 0) {
    const decimalSeparator = comma > dot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = unsigned.split(thousandsSeparator).join("").replace(decimalSeparator, ".");
  } else if (comma >= 0 || dot >= 0) {
    const separator = comma >= 0 ? "," : ".";
    const parts = unsigned.split(separator);
    const groupedThousands = parts.length > 2 || (parts.length === 2 && parts[1].length === 3 && parts[0].length >= 1);
    normalized = groupedThousands ? parts.join("") : `${parts[0]}.${parts[1] ?? ""}`;
  } else {
    normalized = unsigned;
  }

  const parsed = Number(`${negative ? "-" : ""}${normalized}`);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export const formatDate = (value: string) => new Intl.DateTimeFormat("pt-PT", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
}).format(new Date(value));

export const initials = (name: string) => name.split(" ").map((part) => part[0]).slice(0, 2).join("");
