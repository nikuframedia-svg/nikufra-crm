import { describe, expect, it } from "vitest";
import { formatCurrency, formatDate } from "./format";

describe("formatação portuguesa", () => {
  it("formata euros com separadores pt-PT", () => {
    expect(formatCurrency(1250)).toContain("1.250,00");
    expect(formatCurrency(1250)).toContain("€");
  });

  it("formata datas em dd/mm/aaaa", () => {
    expect(formatDate("2026-08-24T12:00:00Z")).toBe("24/08/2026");
  });
});
