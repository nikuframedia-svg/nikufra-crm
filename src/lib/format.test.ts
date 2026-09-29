import { describe, expect, it } from "vitest";
import { formatCurrency, formatDate, formatDecimal, formatPercentage, parseMoneyInput } from "./format";

describe("formatação portuguesa", () => {
  it("mostra valores monetários exatos sem abreviar nem inventar casas decimais", () => {
    expect(formatCurrency(1_445.25)).toMatch(/^1\.445,25\s€$/);
    expect(formatCurrency(6_500)).toMatch(/^6\.500\s€$/);
    expect(formatCurrency(10_000)).toMatch(/^10\.000\s€$/);
  });

  it("mantém até duas casas decimais apenas quando são necessárias", () => {
    expect(formatDecimal(25)).toBe("25");
    expect(formatDecimal(25.5)).toBe("25,5");
    expect(formatDecimal(25.125)).toBe("25,13");
    expect(formatPercentage(100 / 3)).toBe("33,33%");
  });

  it("formata datas em dd/mm/aaaa", () => {
    expect(formatDate("2026-08-24T12:00:00Z")).toBe("24/08/2026");
  });

  it("interpreta separadores de milhares e decimais como um utilizador português", () => {
    expect(parseMoneyInput("2,500")).toBe(2500);
    expect(parseMoneyInput("2.500")).toBe(2500);
    expect(parseMoneyInput("2,50")).toBe(2.5);
    expect(parseMoneyInput("1.445,25 €")).toBe(1445.25);
    expect(parseMoneyInput("1,445.25")).toBe(1445.25);
  });
});
