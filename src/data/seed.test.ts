import { describe, expect, it } from "vitest";
import { initialLeads, initialOpportunities, stageOrder, stageProbability } from "./seed";

describe("dados comerciais de demonstração", () => {
  it("cobre todas as etapas do funil", () => {
    const present = new Set(initialOpportunities.map((item) => item.estado));
    for (const stage of stageOrder) expect(present.has(stage)).toBe(true);
  });

  it("mantém contacto e oportunidade alinhados", () => {
    expect(initialLeads).toHaveLength(initialOpportunities.length);
    for (const opportunity of initialOpportunities) {
      expect(initialLeads.some((lead) => lead.id === opportunity.leadId)).toBe(true);
      expect(opportunity.probabilidade).toBe(stageProbability[opportunity.estado]);
    }
  });
});
