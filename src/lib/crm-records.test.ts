import { describe, expect, it } from "vitest";
import { pruneCommercialRecords } from "./crm-records";
import type { Activity, Lead, Opportunity } from "../types";

const leads = [
  { id: "contact-a", empresaId: "company-a", nome: "Ana", empresa: "A", cargo: "", email: "a@example.com", telefone: "", vertical: "Outro", cidade: "", pais: "PT", origem: "", estado: "contactado", ownerId: "owner" },
  { id: "contact-b", empresaId: "company-a", nome: "Bia", empresa: "A", cargo: "", email: "b@example.com", telefone: "", vertical: "Outro", cidade: "", pais: "PT", origem: "", estado: "contactado", ownerId: "owner" },
  { id: "contact-c", empresaId: "company-b", nome: "Cris", empresa: "B", cargo: "", email: "c@example.com", telefone: "", vertical: "Outro", cidade: "", pais: "PT", origem: "", estado: "contactado", ownerId: "owner" },
] satisfies Lead[];

const opportunities = [
  { id: "opportunity-a", empresaId: "company-a", leadId: "contact-a", empresa: "A", titulo: "A", estado: "contactado", tipo: "Consultoria", valor: 0, probabilidade: 5, ownerId: "owner", diasNoEstado: 1, dataPrimeiroContacto: "", dataFechoPrevista: "" },
  { id: "opportunity-b", empresaId: "company-b", leadId: "contact-c", empresa: "B", titulo: "B", estado: "contactado", tipo: "Consultoria", valor: 0, probabilidade: 5, ownerId: "owner", diasNoEstado: 1, dataPrimeiroContacto: "", dataFechoPrevista: "" },
] satisfies Opportunity[];

const activities = [
  { id: "activity-a", oportunidadeId: "opportunity-a", empresa: "A", userId: "owner", tipo: "email", descricao: "A", data: "2026-08-01", contactoId: "contact-a" },
  { id: "activity-b", oportunidadeId: "opportunity-b", empresa: "B", userId: "owner", tipo: "email", descricao: "B", data: "2026-08-01", contactoId: "contact-c" },
] satisfies Activity[];

describe("commercial record pruning", () => {
  it("removes every contact, opportunity and activity in the selected company", () => {
    const result = pruneCommercialRecords({ leads, opportunities, activities }, { contactIds: ["contact-b"] });

    expect(result.leads.map((item) => item.id)).toEqual(["contact-c"]);
    expect(result.opportunities.map((item) => item.id)).toEqual(["opportunity-b"]);
    expect(result.activities.map((item) => item.id)).toEqual(["activity-b"]);
  });

  it("can delete the same record directly from a Kanban opportunity", () => {
    const result = pruneCommercialRecords({ leads, opportunities, activities }, { opportunityIds: ["opportunity-a"] });

    expect(result.companyIds).toContain("company-a");
    expect(result.leads).toHaveLength(1);
    expect(result.opportunities).toHaveLength(1);
  });
});
