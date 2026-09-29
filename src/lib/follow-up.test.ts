import { describe, expect, it } from "vitest";
import { daysSinceLastInteraction, isWithinDayRange, rankFollowUps } from "./follow-up";
import type { FollowUpSuggestion } from "../types";

function suggestion(overrides: Partial<FollowUpSuggestion>): FollowUpSuggestion {
  return {
    contactId: crypto.randomUUID(),
    empresaId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    empresa: "Empresa",
    contactoNome: "Contacto",
    contactoEmail: "contacto@example.com",
    contactoCargo: "",
    estado: "contactado",
    ultimaInteracaoEm: "2026-07-06T12:00:00.000Z",
    totalInteracoes: 1,
    totalMensagens: 1,
    emailsEnviados: 1,
    emailsRecebidos: 0,
    reunioes: 0,
    ultimoAssunto: "Assunto",
    ultimoResumo: "Resumo",
    ...overrides,
  };
}

describe("follow-up ranking", () => {
  const now = new Date("2026-08-25T12:00:00.000Z");

  it("prioritizes the longest silence before interaction volume", () => {
    const ranked = rankFollowUps([
      suggestion({ contactoNome: "Recente", ultimaInteracaoEm: "2026-07-16T12:00:00.000Z", totalInteracoes: 100 }),
      suggestion({ contactoNome: "Antigo", ultimaInteracaoEm: "2026-07-06T12:00:00.000Z", totalInteracoes: 1 }),
    ], now);

    expect(ranked.map((item) => item.contactoNome)).toEqual(["Antigo", "Recente"]);
  });

  it("uses interaction volume as the tie-break for equal inactivity", () => {
    const ranked = rankFollowUps([
      suggestion({ contactoNome: "Uma mensagem", totalInteracoes: 1 }),
      suggestion({ contactoNome: "Cinco mensagens", totalInteracoes: 5, totalMensagens: 5 }),
    ], now);

    expect(ranked.map((item) => item.contactoNome)).toEqual(["Cinco mensagens", "Uma mensagem"]);
  });

  it("never returns negative inactivity for future timestamps", () => {
    expect(daysSinceLastInteraction("2026-09-01T12:00:00.000Z", now)).toBe(0);
  });

  it("filters inclusive day ranges with optional limits", () => {
    expect(isWithinDayRange(30, 30, 60)).toBe(true);
    expect(isWithinDayRange(60, 30, 60)).toBe(true);
    expect(isWithinDayRange(29, 30, 60)).toBe(false);
    expect(isWithinDayRange(61, 30, 60)).toBe(false);
    expect(isWithinDayRange(90, 60, null)).toBe(true);
    expect(isWithinDayRange(7, null, 14)).toBe(true);
  });
});
