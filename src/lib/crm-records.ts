import type { Activity, Lead, Opportunity } from "../types";

export function pruneCommercialRecords(
  current: { leads: Lead[]; opportunities: Opportunity[]; activities: Activity[] },
  input: { companyIds?: string[]; contactIds?: string[]; opportunityIds?: string[] },
) {
  const companyIds = new Set(input.companyIds ?? []);
  const contactIds = new Set(input.contactIds ?? []);
  const explicitOpportunityIds = new Set(input.opportunityIds ?? []);

  for (const lead of current.leads) {
    if (contactIds.has(lead.id) && lead.empresaId) companyIds.add(lead.empresaId);
  }
  for (const opportunity of current.opportunities) {
    if ((explicitOpportunityIds.has(opportunity.id) || contactIds.has(opportunity.leadId)) && opportunity.empresaId) {
      companyIds.add(opportunity.empresaId);
    }
  }

  const removedContactIds = new Set(current.leads
    .filter((lead) => contactIds.has(lead.id) || Boolean(lead.empresaId && companyIds.has(lead.empresaId)))
    .map((lead) => lead.id));
  const removedOpportunityIds = new Set(current.opportunities
    .filter((opportunity) => explicitOpportunityIds.has(opportunity.id) || Boolean(opportunity.empresaId && companyIds.has(opportunity.empresaId)))
    .map((opportunity) => opportunity.id));

  return {
    companyIds: [...companyIds],
    leads: current.leads.filter((lead) => !removedContactIds.has(lead.id)),
    opportunities: current.opportunities.filter((opportunity) => !removedOpportunityIds.has(opportunity.id)),
    activities: current.activities.filter((activity) =>
      !removedContactIds.has(activity.contactoId ?? "")
      && !removedOpportunityIds.has(activity.oportunidadeId)
    ),
  };
}
