import { activeUser, adminClient, corsHeaders } from "../_shared/security.ts";

const allowedStages = new Set(["nao_contactado", "contactado", "reuniao_marcada", "reuniao_feita", "proposta", "piloto", "cliente", "perdido", "adiado"]);
const verticals: Record<string, string> = { "Metalomecânica": "metalomecanica", "Automóvel": "automovel", "Alumínio": "aluminio", "Cortiça": "cortica", "Compósitos": "compositos", "Eletrónica": "eletronica", Outro: "outro" };
const publicEmailDomains = new Set(["gmail.com", "hotmail.com", "hotmail.pt", "outlook.com", "outlook.pt", "icloud.com", "me.com", "live.com", "live.pt", "yahoo.com", "yahoo.es", "sapo.pt"]);

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}

function clean(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function businessDomain(email: string) {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  return domain && !publicEmailDomains.has(domain) ? domain : null;
}

function validUuid(value: unknown) {
  const text = clean(value, 36);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : crypto.randomUUID();
}

async function insertChunks(admin: ReturnType<typeof adminClient>, table: string, rows: Array<Record<string, unknown>>, size = 250) {
  const inserted: Array<Record<string, unknown>> = [];
  for (let index = 0; index < rows.length; index += size) {
    const { data, error } = await admin.from(table).insert(rows.slice(index, index + size)).select();
    if (error) throw error;
    inserted.push(...(data ?? []));
  }
  return inserted;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { user } = await activeUser(request);
    const body = await request.json();
    const leads = (Array.isArray(body.leads) ? body.leads.slice(0, 1000) : []) as Array<Record<string, unknown>>;
    const incomingOpportunities = (Array.isArray(body.opportunities) ? body.opportunities.slice(0, 1000) : []) as Array<Record<string, unknown>>;
    const incomingActivities = (Array.isArray(body.activities) ? body.activities.slice(0, 2000) : []) as Array<Record<string, unknown>>;
    const revenueEntries = (Array.isArray(body.revenueEntries) ? body.revenueEntries.slice(0, 1000) : []) as Array<Record<string, unknown>>;
    const requestedNikufraFinancials = body.includeNikufraFinancials === true;
    if (!leads.length) return Response.json({ error: "Sem contactos para importar" }, { status: 400, headers: corsHeaders });
    const admin = adminClient();
    const [{ data: existingCompanies, error: companyLoadError }, { data: existingContacts, error: contactLoadError }, { data: existingOpportunities, error: opportunityLoadError }] = await Promise.all([
      admin.from("empresas").select("id,nome,nome_normalizado,email_domain"),
      admin.from("contactos").select("id,email,empresa_id"),
      admin.from("oportunidades").select("id,empresa_id,import_key"),
    ]);
    const firstError = companyLoadError ?? contactLoadError ?? opportunityLoadError;
    if (firstError) throw firstError;

    const companyByName = new Map((existingCompanies ?? []).map((company) => [company.nome_normalizado || normalize(company.nome), company]));
    const companyByDomain = new Map((existingCompanies ?? []).filter((company) => company.email_domain && !publicEmailDomains.has(String(company.email_domain).toLowerCase())).map((company) => [String(company.email_domain).toLowerCase(), company]));
    const leadByCompany = new Map<string, Record<string, unknown>>();
    for (const lead of leads) {
      const companyName = clean(lead.empresa, 240); const email = clean(lead.email, 320).toLowerCase();
      if (!companyName || !email.includes("@")) continue;
      if (!leadByCompany.has(normalize(companyName))) leadByCompany.set(normalize(companyName), lead);
    }
    const includeNikufraFinancials = requestedNikufraFinancials && leads.length >= 400
      && ["metalogalva", "nelo", "jorgepires", "ficosa"].every((company) => leadByCompany.has(company));
    if (includeNikufraFinancials) revenueEntries.push(
      { id: "fe60656b-6824-51bb-83be-1f32256f3ae1", empresa: "Metalogalva", data: "2026-08-25", tipo: "Contratualizado", valor: 5000, descricao: "Valor indicado: 5 mil euros", ref: "Entrada manual" },
      { id: "f08868e1-99b5-57a9-a8f6-16cc05432988", empresa: "Metalogalva", data: "2026-07-15", tipo: "Faturado", valor: 2500, valorBruto: 2500, iva: 0, descricao: "Faturação indicada pelo utilizador", ref: "Entrada manual" },
      { id: "fad6ff7f-0e18-5ace-857f-e0fe8f42309c", empresa: "Nelo", data: "2026-08-25", tipo: "Contratualizado", valor: 40000, descricao: "Valor contratualizado indicado pelo utilizador", ref: "Entrada manual" },
      { id: "6fa7335c-7fd3-50fd-bdbb-a8067bcfc675", empresa: "Nelo", data: "2026-03-19", tipo: "Faturado", valor: 10000, valorBruto: 10000, iva: 0, descricao: "Faturação indicada pelo utilizador", ref: "Entrada manual" },
      { id: "69b1abf3-1ab9-5051-8995-97ff2a8444a4", empresa: "Jorge Pires", data: "2026-05-25", tipo: "Contratualizado", valor: 6500, descricao: "Valor contratualizado indicado pelo utilizador", ref: "Entrada manual" },
      { id: "cc9f0090-b4a8-5c68-aca7-3157162ae5d4", empresa: "Ficosa", data: "2026-06-18", tipo: "Faturado", valor: 1175, valorBruto: 1445.25, iva: 270.25, taxaIva: 23, descricao: "Base sem IVA; total indicado de 1.445,25 € à taxa de 23%", ref: "Entrada manual" },
    );
    const companiesToInsert: Array<Record<string, unknown>> = [];
    const companiesToUpdate: Array<Record<string, unknown>> = [];
    for (const [key, lead] of leadByCompany) {
      if (companyByName.has(key)) continue;
      const companyName = clean(lead.empresa, 240); const email = clean(lead.email, 320).toLowerCase();
      const emailDomain = businessDomain(email);
      const existingByDomain = emailDomain ? companyByDomain.get(emailDomain) : undefined;
      if (existingByDomain) {
        const updated = { ...existingByDomain, nome: companyName, nome_normalizado: key, vertical: verticals[clean(lead.vertical)] ?? "outro" };
        companyByName.set(key, updated); companiesToUpdate.push({ id: existingByDomain.id, nome: companyName, nome_normalizado: key, vertical: updated.vertical });
        continue;
      }
      companiesToInsert.push({ id: validUuid(lead.empresaId), nome: companyName, nome_normalizado: key, email_domain: emailDomain, vertical: verticals[clean(lead.vertical)] ?? "outro", pais: clean(lead.pais, 2).toUpperCase() || "PT", cidade: clean(lead.cidade, 120) || null, origem: "outbound_email", notas: "Importada por CSV" });
    }
    const companyUpdates = await Promise.all(companiesToUpdate.map((row) => admin.from("empresas").update({ nome: row.nome, nome_normalizado: row.nome_normalizado, vertical: row.vertical }).eq("id", row.id)));
    const companyUpdateError = companyUpdates.find((result) => result.error)?.error;
    if (companyUpdateError) throw companyUpdateError;
    const insertedCompanies = await insertChunks(admin, "empresas", companiesToInsert);
    for (const company of insertedCompanies) companyByName.set(String(company.nome_normalizado), company);
    const newCompanyIds = new Set(insertedCompanies.map((company) => String(company.id)));

    const contactByEmail = new Map((existingContacts ?? []).filter((contact) => contact.email).map((contact) => [String(contact.email).toLowerCase(), contact]));
    const firstNewContactByCompany = new Set<string>();
    const contactsToInsert: Array<Record<string, unknown>> = [];
    const contactsToUpdate: Array<{ id: unknown; changes: Record<string, unknown> }> = [];
    for (const lead of leads) {
      const email = clean(lead.email, 320).toLowerCase(); const company = companyByName.get(normalize(clean(lead.empresa, 240)));
      if (!email.includes("@") || !company) continue;
      const existing = contactByEmail.get(email); const leadStage = clean(lead.estado);
      if (existing) {
        const changes: Record<string, unknown> = { empresa_id: company.id, nome: clean(lead.nome, 240) || email, email, estado: allowedStages.has(leadStage) ? leadStage : "nao_contactado" };
        const cargo = clean(lead.cargo, 240); const phone = clean(lead.telefone, 80); const meetingDate = clean(lead.dataReuniao, 10);
        if (cargo) changes.cargo = cargo;
        if (phone) changes.telefone = phone;
        if (meetingDate) changes.data_reuniao = meetingDate;
        contactsToUpdate.push({ id: existing.id, changes });
        continue;
      }
      if (contactsToInsert.some((row) => row.email === email)) continue;
      const companyId = String(company.id); const principal = newCompanyIds.has(companyId) && !firstNewContactByCompany.has(companyId);
      if (principal) firstNewContactByCompany.add(companyId);
      contactsToInsert.push({ id: validUuid(lead.id), empresa_id: companyId, nome: clean(lead.nome, 240) || email, cargo: clean(lead.cargo, 240) || null, email, telefone: clean(lead.telefone, 80) || null, principal, estado: allowedStages.has(leadStage) ? leadStage : "nao_contactado", data_reuniao: clean(lead.dataReuniao, 10) || null, notas: "Importado por CSV" });
    }
    for (let index = 0; index < contactsToUpdate.length; index += 25) {
      const results = await Promise.all(contactsToUpdate.slice(index, index + 25).map((item) => admin.from("contactos").update(item.changes).eq("id", item.id)));
      const error = results.find((result) => result.error)?.error; if (error) throw error;
    }
    const insertedContacts = await insertChunks(admin, "contactos", contactsToInsert);
    for (const contact of insertedContacts) contactByEmail.set(String(contact.email).toLowerCase(), contact);

    const opportunityByCompany = new Map((existingOpportunities ?? []).map((opportunity) => [String(opportunity.empresa_id), opportunity]));
    const incomingOpportunityBySourceCompany = new Map(incomingOpportunities.map((opportunity) => [clean(opportunity.empresaId), opportunity]));
    const opportunitiesToInsert: Array<Record<string, unknown>> = [];
    const opportunitiesToUpdate: Array<{ id: unknown; changes: Record<string, unknown> }> = [];
    for (const [key, lead] of leadByCompany) {
      const company = companyByName.get(key); if (!company) continue;
      const incoming = incomingOpportunityBySourceCompany.get(clean(lead.empresaId)) ?? {};
      const stageCandidate = clean(incoming.estado || lead.estado); const state = allowedStages.has(stageCandidate) ? stageCandidate : "nao_contactado";
      const primaryEmail = clean(lead.email, 320).toLowerCase(); const contact = contactByEmail.get(primaryEmail);
      const existingOpportunity = opportunityByCompany.get(String(company.id));
      if (existingOpportunity) {
        const changes: Record<string, unknown> = { estado: state, contacto_principal_id: contact?.id ?? null };
        const milestones: Array<[string, string]> = [
          ["data_primeiro_contacto", clean(incoming.dataPrimeiroContacto, 10)],
          ["data_reuniao", clean(incoming.dataReuniao, 10)],
          ["data_proposta", clean(incoming.dataProposta, 10)],
          ["data_piloto", clean(incoming.dataPiloto, 10)],
          ["data_fecho", clean(incoming.dataFecho, 10)],
          ["data_prevista_fecho", clean(incoming.dataFechoPrevista, 10)],
        ];
        for (const [field, value] of milestones) if (value) changes[field] = value;
        const value = Number(incoming.valor); const recurring = Number(incoming.recorrenteAnual); const rating = Number(incoming.avaliacao); const notes = clean(incoming.notas, 4000);
        if (Number.isFinite(value) && value > 0) changes.valor_estimado = value;
        if (Number.isFinite(recurring) && recurring > 0) changes.valor_recorrente_anual = recurring;
        if (Number.isFinite(rating) && rating >= 1 && rating <= 5) changes.avaliacao = rating;
        if (notes) changes.notas = notes;
        opportunitiesToUpdate.push({ id: existingOpportunity.id, changes });
        continue;
      }
      opportunitiesToInsert.push({ id: validUuid(incoming.id), empresa_id: company.id, contacto_principal_id: contact?.id ?? null, owner_id: user.id, titulo: clean(incoming.titulo, 240) || "Oportunidade inicial", estado: state, tipo: "consultoria", valor_estimado: Math.max(0, Number(incoming.valor) || 0), valor_recorrente_anual: incoming.recorrenteAnual == null ? null : Math.max(0, Number(incoming.recorrenteAnual) || 0), data_primeiro_contacto: clean(incoming.dataPrimeiroContacto, 10) || null, data_reuniao: clean(incoming.dataReuniao, 10) || null, data_proposta: clean(incoming.dataProposta, 10) || null, data_piloto: clean(incoming.dataPiloto, 10) || null, data_fecho: clean(incoming.dataFecho, 10) || null, data_prevista_fecho: clean(incoming.dataFechoPrevista, 10) || null, avaliacao: Number(incoming.avaliacao) || null, notas: clean(incoming.notas, 4000), import_key: `csv:${key}` });
    }
    for (let index = 0; index < opportunitiesToUpdate.length; index += 25) {
      const results = await Promise.all(opportunitiesToUpdate.slice(index, index + 25).map((item) => admin.from("oportunidades").update(item.changes).eq("id", item.id)));
      const error = results.find((result) => result.error)?.error; if (error) throw error;
    }
    const insertedOpportunities = await insertChunks(admin, "oportunidades", opportunitiesToInsert);
    for (const opportunity of insertedOpportunities) opportunityByCompany.set(String(opportunity.empresa_id), opportunity);

    const allowedActivityTypes = new Set(["email", "chamada", "reuniao", "proposta", "nota"]);
    const activityRows: Array<Record<string, unknown>> = [];
    for (const activity of incomingActivities) {
      const company = companyByName.get(normalize(clean(activity.empresa, 240)));
      if (!company) continue;
      const opportunity = opportunityByCompany.get(String(company.id));
      const contactId = clean(activity.contactoId, 36);
      const contact = [...contactByEmail.values()].find((candidate) => String(candidate.id) === contactId);
      const activityType = clean(activity.tipo, 40);
      const date = clean(activity.data, 40);
      activityRows.push({
        id: validUuid(activity.id),
        oportunidade_id: opportunity?.id ?? null,
        empresa_id: company.id,
        contacto_id: contact?.id ?? null,
        user_id: user.id,
        tipo: allowedActivityTypes.has(activityType) ? activityType : "nota",
        data: date || new Date().toISOString(),
        descricao: clean(activity.descricao, 4000) || "Atividade importada",
      });
    }
    for (let index = 0; index < activityRows.length; index += 250) {
      const { error } = await admin.from("atividades").upsert(activityRows.slice(index, index + 250), { onConflict: "id" });
      if (error) throw error;
    }

    const billingRows: Array<Record<string, unknown>> = [];
    for (const entry of revenueEntries) {
      const company = companyByName.get(normalize(clean(entry.empresa, 240))); const type = clean(entry.tipo).toLowerCase();
      if (!company || !["contratualizado", "faturado", "recebido"].includes(type)) continue;
      const opportunity = opportunityByCompany.get(String(company.id));
      billingRows.push({ id: validUuid(entry.id), empresa_id: company.id, oportunidade_id: opportunity?.id ?? null, tipo: type, valor: Math.max(0, Number(entry.valor) || 0), valor_bruto: entry.valorBruto == null ? null : Math.max(0, Number(entry.valorBruto) || 0), valor_iva: entry.iva == null ? null : Math.max(0, Number(entry.iva) || 0), taxa_iva: entry.taxaIva == null ? null : Math.max(0, Number(entry.taxaIva) || 0), data: clean(entry.data, 10), descricao: clean(entry.descricao, 500), referencia_externa: clean(entry.ref, 240) || null });
    }
    for (let index = 0; index < billingRows.length; index += 250) {
      const { error } = await admin.from("faturacao").upsert(billingRows.slice(index, index + 250), { onConflict: "id" });
      if (error) throw error;
    }
    if (includeNikufraFinancials) {
      const values: Record<string, number> = { metalogalva: 5000, nelo: 40000, jorgepires: 6500, ficosa: 1175 };
      const updates = Object.entries(values).flatMap(([key, value]) => {
        const company = companyByName.get(key);
        const opportunity = company ? opportunityByCompany.get(String(company.id)) : null;
        return opportunity ? [{ opportunityId: opportunity.id, value }] : [];
      });
      const results = await Promise.all(updates.map(({ opportunityId, value }) =>
        admin.from("oportunidades").update({ valor_estimado: value }).eq("id", opportunityId)
      ));
      const error = results.find((result) => result.error)?.error; if (error) throw error;
    }
    return Response.json({ contactsCreated: insertedContacts.length, contactsUpdated: contactsToUpdate.length, companiesCreated: insertedCompanies.length, opportunitiesCreated: insertedOpportunities.length, opportunitiesUpdated: opportunitiesToUpdate.length, activitiesImported: activityRows.length, revenueImported: billingRows.length }, { headers: corsHeaders });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400, headers: corsHeaders });
  }
});
