import { describe, expect, it } from "vitest";
import { initialActivities, initialDrafts, initialLeads, initialOpportunities, owners, stageOrder, stageProbability } from "./seed";

describe("configuração comercial segura", () => {
  it("mantém a progressão do funil e probabilidades válidas", () => {
    expect(stageOrder).toEqual(["nao_contactado", "contactado", "reuniao_marcada", "reuniao_feita", "proposta", "piloto", "cliente"]);
    for (const probability of Object.values(stageProbability)) expect(probability).toBeGreaterThanOrEqual(0);
  });

  it("não embebe contactos, negócios ou atividades na configuração de produção", () => {
    expect(initialLeads).toEqual([]);
    expect(initialOpportunities).toEqual([]);
    expect(initialActivities).toEqual([]);
    expect(initialDrafts).toEqual([]);
  });

  it("só mantém o operador local de desenvolvimento", () => {
    expect(owners).toHaveLength(1);
    expect(owners[0].nome).toBe("João Milhazes");
  });
});
