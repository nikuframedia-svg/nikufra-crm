import type { Activity, Draft, Lead, Opportunity, Owner, RevenueEntry, RevenueMonth, Stage } from "../types";

export const stageOrder: Stage[] = [
  "nao_contactado", "contactado", "reuniao_marcada", "reuniao_feita", "piloto", "proposta", "cliente",
];

// "Recusado" is visible on the board, but stays outside the active funnel metrics.
export const pipelineBoardOrder: Stage[] = [...stageOrder, "perdido"];

export const stageLabels: Record<Stage, string> = {
  nao_contactado: "Não contactado", contactado: "Contactado", reuniao_marcada: "Reunião marcada",
  reuniao_feita: "Reunião feita", proposta: "Proposta", piloto: "Piloto", cliente: "Cliente",
  perdido: "Recusado", adiado: "Adiado",
};

export const stageProbability: Record<Stage, number> = {
  nao_contactado: 0, contactado: 5, reuniao_marcada: 15, reuniao_feita: 30,
  piloto: 50, proposta: 75, cliente: 100, perdido: 0, adiado: 10,
};

// Placeholder visual para referências sem responsável. Nunca representa um utilizador real.
export const owners: Owner[] = [
  { id: "unassigned", nome: "Sem responsável", email: "", iniciais: "—", cor: "#64748b", role: "member" },
];

export const initialLeads: Lead[] = [];
export const initialOpportunities: Opportunity[] = [];
export const initialActivities: Activity[] = [];
export const initialDrafts: Draft[] = [];
export const revenueMonths: RevenueMonth[] = [];
export const revenueEntries: RevenueEntry[] = [];

// O guard DEV permite ao Rollup eliminar este import e todos os dados pessoais da build de produção.
export async function loadLocalRealData() {
  if (!import.meta.env.DEV) return null;
  const localModule = "/src/data/real-data.generated.ts";
  try { return await import(/* @vite-ignore */ localModule); }
  catch { return null; }
}
