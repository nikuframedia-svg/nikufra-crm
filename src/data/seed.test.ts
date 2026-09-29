import { describe, expect, it } from "vitest";
import { initialActivities, initialDrafts, initialLeads, initialOpportunities, owners, pipelineBoardOrder, stageOrder, stageProbability } from "./seed";

describe("configuração comercial segura", () => {
  it("mantém a progressão do funil e probabilidades válidas", () => {
    expect(stageOrder).toEqual(["nao_contactado", "contactado", "reuniao_marcada", "reuniao_feita", "piloto", "proposta", "cliente"]);
    expect(pipelineBoardOrder).toEqual([...stageOrder, "perdido"]);
    for (const probability of Object.values(stageProbability)) expect(probability).toBeGreaterThanOrEqual(0);
    expect(stageProbability.piloto).toBeLessThan(stageProbability.proposta);
  });

  it("não embebe contactos, negócios ou atividades na configuração de produção", () => {
    expect(initialLeads).toEqual([]);
    expect(initialOpportunities).toEqual([]);
    expect(initialActivities).toEqual([]);
    expect(initialDrafts).toEqual([]);
  });

  it("não embebe utilizadores reais ou fictícios na configuração", () => {
    expect(owners).toHaveLength(1);
    expect(owners[0]).toMatchObject({ id: "unassigned", nome: "Sem responsável", email: "" });
  });
});
