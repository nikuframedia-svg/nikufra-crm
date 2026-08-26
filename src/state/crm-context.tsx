import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { initialActivities, initialDrafts, initialLeads, initialOpportunities, loadLocalRealData, owners as initialOwners, stageProbability } from "../data/seed";
import { pruneCommercialRecords } from "../lib/crm-records";
import { supabase } from "../lib/supabase";
import type { Activity, CommercialDeletionResult, Draft, FollowUpSuggestion, Lead, Opportunity, Owner, Stage, Vertical } from "../types";

interface CRMState {
  leads: Lead[];
  opportunities: Opportunity[];
  activities: Activity[];
  followUpSuggestions: FollowUpSuggestion[];
  drafts: Draft[];
  team: Owner[];
  currentUserId: string;
  emailSelection: string[];
  setEmailSelection: (ids: string[]) => void;
  dataMode: "local" | "supabase";
  moveOpportunity: (id: string, estado: Stage, loss?: { motivo: string; notas: string }) => void;
  addOpportunity: (opportunity: Opportunity, lead: Lead) => void;
  importBatch: (leads: Lead[], opportunities: Opportunity[], options?: { includeNikufraFinancials?: boolean }) => Promise<void>;
  updateOpportunity: (id: string, changes: Partial<Opportunity>) => void;
  updateLead: (id: string, field: keyof Lead, value: string) => void;
  deleteCommercialRecords: (input: { contactIds?: string[]; companyIds?: string[]; opportunityIds?: string[] }) => Promise<CommercialDeletionResult>;
  addDrafts: (drafts: Draft[]) => void;
  addActivity: (activity: Activity) => void;
}

const CRMContext = createContext<CRMState | null>(null);

const verticalFromDb: Record<string, Vertical> = {
  metalomecanica: "Metalomecânica", automovel: "Automóvel", aluminio: "Alumínio", cortica: "Cortiça", compositos: "Compósitos", eletronica: "Eletrónica", outro: "Outro",
};
const verticalToDb: Record<Vertical, string> = { "Metalomecânica": "metalomecanica", "Automóvel": "automovel", "Alumínio": "aluminio", "Cortiça": "cortica", "Compósitos": "compositos", "Eletrónica": "eletronica", "Outro": "outro" };
const opportunityTypeFromDb: Record<string, Opportunity["tipo"]> = { consultoria: "Consultoria", licenca_pp1: "Licença PP1", piloto: "Piloto", misto: "Misto" };
const opportunityTypeToDb: Record<Opportunity["tipo"], string> = { Consultoria: "consultoria", "Licença PP1": "licenca_pp1", Piloto: "piloto", Misto: "misto" };

function readStored<T>(key: string, fallback: T): T {
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) as T : fallback;
  } catch {
    return fallback;
  }
}

export function CRMProvider({ children }: { children: ReactNode }) {
  const [leads, setLeads] = useState<Lead[]>(() => readStored("nikufra:v2:leads", initialLeads));
  const [opportunities, setOpportunities] = useState<Opportunity[]>(() => readStored("nikufra:v2:opportunities", initialOpportunities));
  const [activities, setActivities] = useState<Activity[]>(initialActivities);
  const [followUpSuggestions, setFollowUpSuggestions] = useState<FollowUpSuggestion[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>(initialDrafts);
  const [team, setTeam] = useState<Owner[]>(initialOwners);
  const [currentUserId, setCurrentUserId] = useState(initialOwners[0].id);
  const [emailSelection, setEmailSelection] = useState<string[]>([]);

  useEffect(() => {
    if (!supabase) {
      let active = true;
      void loadLocalRealData().then((data) => {
        if (!active || !data) return;
        setLeads((current) => current.length ? current : data.realLeads);
        setOpportunities((current) => current.length ? current : data.realOpportunities);
        setActivities(data.realActivities);
      });
      return () => { active = false; };
    }
    let active = true;

    async function loadServerState() {
      const { data: authData } = await supabase!.auth.getUser();
      const activeUserId = authData.user?.id;
      if (active && activeUserId) setCurrentUserId(activeUserId);
      const [profilesResult, opportunitiesResult, activitiesResult, contactsResult, historyResult, suggestionsResult] = await Promise.all([
        supabase!.from("profiles").select("id,nome,email,role,cor").eq("ativo", true).order("nome"),
        supabase!.from("oportunidades").select("id,titulo,estado,tipo,valor_estimado,valor_recorrente_anual,probabilidade,owner_id,data_primeiro_contacto,data_reuniao,data_proposta,data_piloto,data_fecho,data_prevista_fecho,ciclo_acordo_meses,avaliacao,notas,created_at,updated_at,empresa_id,contacto_principal_id,empresas(id,nome,vertical,cidade,pais,origem)").eq("arquivado", false).order("updated_at", { ascending: false }),
        supabase!.from("atividades").select("id,oportunidade_id,contacto_id,user_id,tipo,descricao,data,direcao,reuniao_inferida,thread_id,assunto,snippet,empresas(nome),contactos(nome,email)").order("data", { ascending: false }).limit(500),
        supabase!.from("contactos").select("id,empresa_id,nome,cargo,email,telefone,optout,estado,data_reuniao,empresas(id,nome,vertical,cidade,pais,origem)").order("updated_at", { ascending: false }),
        supabase!.from("estado_historico").select("oportunidade_id,changed_at").order("changed_at", { ascending: false }),
        supabase!.from("follow_up_suggestions").select("contact_id,empresa_id,opportunity_id,owner_id,user_id,empresa,contacto_nome,contacto_email,contacto_cargo,estado,ultima_interacao_em,total_interacoes,total_mensagens,emails_enviados,emails_recebidos,reunioes,ultimo_assunto,ultimo_resumo").eq("user_id", activeUserId ?? "00000000-0000-0000-0000-000000000000"),
      ]);
      if (!active) return;
      if (profilesResult.data?.length) {
        setTeam(profilesResult.data.map((profile) => ({ id: profile.id, nome: profile.nome, email: profile.email, iniciais: profile.nome.split(" ").map((part: string) => part[0]).slice(0, 2).join(""), cor: profile.cor, role: profile.role })));
      }
      if (opportunitiesResult.error) console.error("Falha ao carregar oportunidades", opportunitiesResult.error.message);
      if (opportunitiesResult.data) {
        const latestStateChange = new Map<string, string>();
        for (const row of historyResult.data ?? []) if (!latestStateChange.has(row.oportunidade_id)) latestStateChange.set(row.oportunidade_id, row.changed_at);
        const serverOpportunities: Opportunity[] = opportunitiesResult.data.map((row) => {
          const company = Array.isArray(row.empresas) ? row.empresas[0] : row.empresas;
          const enteredAt = latestStateChange.get(row.id) ?? row.created_at;
          return { id: row.id, leadId: row.contacto_principal_id ?? row.id, empresaId: row.empresa_id, empresa: company?.nome ?? "Empresa", titulo: row.titulo, estado: row.estado, tipo: opportunityTypeFromDb[row.tipo] ?? "Consultoria", valor: Number(row.valor_estimado), probabilidade: row.probabilidade, ownerId: row.owner_id, diasNoEstado: Math.max(0, Math.floor((Date.now() - new Date(enteredAt).getTime()) / 86400000)), dataPrimeiroContacto: row.data_primeiro_contacto ?? "", dataReuniao: row.data_reuniao ?? undefined, dataProposta: row.data_proposta ?? undefined, dataPiloto: row.data_piloto ?? undefined, dataFecho: row.data_fecho ?? undefined, dataFechoPrevista: row.data_prevista_fecho ?? "", cicloAcordoMeses: row.ciclo_acordo_meses == null ? undefined : Number(row.ciclo_acordo_meses), recorrenteAnual: row.valor_recorrente_anual ? Number(row.valor_recorrente_anual) : undefined, avaliacao: row.avaliacao ?? undefined, notas: row.notas ?? "" };
        });
        const serverLeads: Lead[] = (contactsResult.data ?? []).map((contact) => {
          const company = Array.isArray(contact.empresas) ? contact.empresas[0] : contact.empresas;
          const opportunity = opportunitiesResult.data.find((item) => item.empresa_id === contact.empresa_id);
          return { id: contact.id, empresaId: contact.empresa_id, nome: contact.nome, cargo: contact.cargo ?? "", empresa: company?.nome ?? "Empresa", email: contact.email ?? "", telefone: contact.telefone ?? "", vertical: verticalFromDb[company?.vertical ?? "outro"], cidade: company?.cidade ?? "", pais: company?.pais ?? "PT", origem: company?.origem ?? "", estado: opportunity?.estado ?? contact.estado ?? "nao_contactado", ownerId: opportunity?.owner_id ?? profilesResult.data?.[0]?.id ?? initialOwners[0].id, optout: contact.optout, dataReuniao: contact.data_reuniao ?? undefined } satisfies Lead;
        });
        setOpportunities(serverOpportunities);
        setLeads(serverLeads);
      }
      if (activitiesResult.data) {
        setActivities(activitiesResult.data.map((row) => {
          const companies = row.empresas as { nome: string }[] | { nome: string } | null;
          const contacts = row.contactos as { nome: string; email: string | null }[] | { nome: string; email: string | null } | null;
          const contact = Array.isArray(contacts) ? contacts[0] : contacts;
          return { id: row.id, oportunidadeId: row.oportunidade_id ?? "", empresa: (Array.isArray(companies) ? companies[0]?.nome : companies?.nome) ?? "Empresa", userId: row.user_id, tipo: row.tipo === "reuniao" ? "reuniao" : row.tipo === "chamada" ? "chamada" : row.tipo === "proposta_enviada" ? "proposta" : row.tipo === "nota" ? "nota" : "email", descricao: row.descricao, data: row.data, direcao: row.direcao ?? undefined, reuniaoInferida: row.reuniao_inferida ?? false, contactoId: row.contacto_id ?? undefined, threadId: row.thread_id ?? undefined, assunto: row.assunto ?? undefined, snippet: row.snippet ?? undefined, contactoNome: contact?.nome ?? undefined, contactoEmail: contact?.email ?? undefined };
        }));
      }
      if (suggestionsResult.error) console.error("Falha ao carregar sugestões", suggestionsResult.error.message);
      if (suggestionsResult.data) {
        setFollowUpSuggestions(suggestionsResult.data.map((row) => ({
          contactId: row.contact_id,
          empresaId: row.empresa_id,
          opportunityId: row.opportunity_id ?? undefined,
          ownerId: row.owner_id ?? undefined,
          userId: row.user_id,
          empresa: row.empresa,
          contactoNome: row.contacto_nome,
          contactoEmail: row.contacto_email ?? "",
          contactoCargo: row.contacto_cargo ?? "",
          estado: row.estado,
          ultimaInteracaoEm: row.ultima_interacao_em,
          totalInteracoes: Number(row.total_interacoes),
          totalMensagens: Number(row.total_mensagens),
          emailsEnviados: Number(row.emails_enviados),
          emailsRecebidos: Number(row.emails_recebidos),
          reunioes: Number(row.reunioes),
          ultimoAssunto: row.ultimo_assunto ?? "Sem assunto",
          ultimoResumo: row.ultimo_resumo ?? "",
        } satisfies FollowUpSuggestion)));
      }
    }

    void loadServerState();
    const channel = supabase.channel("crm-live").on("postgres_changes", { event: "*", schema: "public", table: "oportunidades" }, () => void loadServerState()).on("postgres_changes", { event: "*", schema: "public", table: "atividades" }, () => void loadServerState()).on("postgres_changes", { event: "*", schema: "public", table: "contactos" }, () => void loadServerState()).subscribe();
    return () => { active = false; void supabase?.removeChannel(channel); };
  }, []);

  const persist = useCallback((key: string, value: unknown) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, []);

  const moveOpportunity = useCallback((id: string, estado: Stage, loss?: { motivo: string; notas: string }) => {
    if (supabase) void supabase.from("oportunidades").update({ estado, ...(estado === "perdido" ? { motivo_perda: loss?.motivo, notas_perda: loss?.notas || null } : {}) }).eq("id", id).then(({ error }) => { if (error) console.error("Falha ao mover oportunidade", error.message); });
    setOpportunities((current) => {
      const next = current.map((item) => item.id === id ? { ...item, estado, probabilidade: stageProbability[estado], diasNoEstado: 0 } : item);
      persist("nikufra:v2:opportunities", next);
      return next;
    });
    setLeads((current) => {
      const opportunity = opportunities.find((item) => item.id === id);
      const next = current.map((lead) => (opportunity?.empresaId && lead.empresaId === opportunity.empresaId) || lead.id === opportunity?.leadId ? { ...lead, estado } : lead);
      persist("nikufra:v2:leads", next);
      return next;
    });
  }, [opportunities, persist]);

  const addOpportunity = useCallback((opportunity: Opportunity, lead: Lead) => {
    setOpportunities((current) => {
      const next = [opportunity, ...current];
      persist("nikufra:v2:opportunities", next);
      return next;
    });
    setLeads((current) => {
      const next = [lead, ...current];
      persist("nikufra:v2:leads", next);
      return next;
    });
    if (supabase) void (async () => {
      const { data: company, error: companyError } = await supabase.from("empresas").insert({ nome: lead.empresa, vertical: verticalToDb[lead.vertical], pais: lead.pais || "PT", cidade: lead.cidade || null, origem: "inbound" }).select("id").single();
      if (companyError || !company) { console.error("Falha ao criar empresa", companyError?.message); return; }
      const { error: contactError } = await supabase.from("contactos").insert({ id: lead.id, empresa_id: company.id, nome: lead.nome, cargo: lead.cargo || null, email: lead.email || null, telefone: lead.telefone || null, principal: true, estado: lead.estado, data_reuniao: lead.dataReuniao || null });
      if (contactError) { console.error("Falha ao criar contacto", contactError.message); return; }
      const { error: opportunityError } = await supabase.from("oportunidades").insert({ id: opportunity.id, empresa_id: company.id, contacto_principal_id: lead.id, owner_id: opportunity.ownerId, titulo: opportunity.titulo, estado: opportunity.estado, tipo: opportunityTypeToDb[opportunity.tipo], valor_estimado: opportunity.valor, probabilidade: opportunity.probabilidade, data_primeiro_contacto: opportunity.dataPrimeiroContacto || null, data_prevista_fecho: opportunity.dataFechoPrevista || null });
      if (opportunityError) console.error("Falha ao criar oportunidade", opportunityError.message);
    })();
  }, [persist]);

  const updateOpportunity = useCallback((id: string, changes: Partial<Opportunity>) => {
    setOpportunities((current) => {
      const next = current.map((item) => item.id === id ? { ...item, ...changes } : item);
      persist("nikufra:v2:opportunities", next);
      return next;
    });
    if (!supabase) return;
    const payload: Record<string, unknown> = {};
    if (changes.titulo !== undefined) payload.titulo = changes.titulo;
    if (changes.valor !== undefined) payload.valor_estimado = changes.valor;
    if (changes.recorrenteAnual !== undefined) payload.valor_recorrente_anual = changes.recorrenteAnual || null;
    if (changes.ownerId !== undefined) payload.owner_id = changes.ownerId;
    if (changes.dataPrimeiroContacto !== undefined) payload.data_primeiro_contacto = changes.dataPrimeiroContacto || null;
    if (changes.dataReuniao !== undefined) payload.data_reuniao = changes.dataReuniao || null;
    if (changes.dataProposta !== undefined) payload.data_proposta = changes.dataProposta || null;
    if (changes.dataPiloto !== undefined) payload.data_piloto = changes.dataPiloto || null;
    if (changes.dataFecho !== undefined) payload.data_fecho = changes.dataFecho || null;
    if (changes.dataFechoPrevista !== undefined) payload.data_prevista_fecho = changes.dataFechoPrevista || null;
    if (changes.cicloAcordoMeses !== undefined) payload.ciclo_acordo_meses = changes.cicloAcordoMeses || null;
    if (changes.avaliacao !== undefined) payload.avaliacao = changes.avaliacao || null;
    if (changes.notas !== undefined) payload.notas = changes.notas;
    if (Object.keys(payload).length) void supabase.from("oportunidades").update(payload).eq("id", id).then(({ error }) => { if (error) console.error("Falha ao editar empresa", error.message); });
  }, [persist]);

  const importBatch = useCallback(async (newLeads: Lead[], newOpportunities: Opportunity[], options: { includeNikufraFinancials?: boolean } = {}) => {
    if (supabase) {
      const { error } = await supabase.functions.invoke("import-leads", { body: { leads: newLeads, opportunities: newOpportunities, includeNikufraFinancials: Boolean(options.includeNikufraFinancials) } });
      if (error) throw new Error(error.message);
    }
    setLeads((current) => {
      const existing = new Set(current.map((lead) => lead.email.toLowerCase()).filter(Boolean));
      const next = [...newLeads.filter((lead) => !existing.has(lead.email.toLowerCase())), ...current];
      persist("nikufra:v2:leads", next);
      return next;
    });
    setOpportunities((current) => {
      const existing = new Set(current.map((item) => item.empresaId ?? item.id));
      const next = [...newOpportunities.filter((item) => !existing.has(item.empresaId ?? item.id)), ...current];
      persist("nikufra:v2:opportunities", next);
      return next;
    });
  }, [persist]);

  const updateLead = useCallback((id: string, field: keyof Lead, value: string) => {
    setLeads((current) => {
      const next = current.map((lead) => lead.id === id ? { ...lead, [field]: value } : lead);
      persist("nikufra:v2:leads", next);
      return next;
    });
    if (supabase && ["nome", "cargo", "email", "telefone"].includes(field)) {
      void supabase.from("contactos").update({ [field]: value }).eq("id", id).then(({ error }) => { if (error) console.error("Falha ao editar contacto", error.message); });
    }
    if (supabase && field === "empresa") {
      const companyId = leads.find((lead) => lead.id === id)?.empresaId;
      if (companyId) void supabase.from("empresas").update({ nome: value }).eq("id", companyId).then(({ error }) => { if (error) console.error("Falha ao editar empresa", error.message); });
    }
    if (field === "vertical") {
      const companyId = leads.find((lead) => lead.id === id)?.empresaId;
      if (supabase && companyId) void supabase.from("empresas").update({ vertical: verticalToDb[value as Vertical] }).eq("id", companyId).then(({ error }) => { if (error) console.error("Falha ao editar vertical", error.message); });
    }
    if (field === "estado" || field === "ownerId") {
      const companyId = leads.find((lead) => lead.id === id)?.empresaId;
      if (supabase && field === "estado") {
        const query = supabase.from("contactos").update({ estado: value });
        void (companyId ? query.eq("empresa_id", companyId) : query.eq("id", id)).then(({ error }) => { if (error) console.error("Falha ao atualizar estado dos contactos", error.message); });
      }
      const opportunity = opportunities.find((item) => item.leadId === id || Boolean(companyId && item.empresaId === companyId));
      if (opportunity) {
        const next = opportunities.map((item) => item.id === opportunity.id ? { ...item, ...(field === "estado" ? { estado: value as Stage, probabilidade: stageProbability[value as Stage], diasNoEstado: 0 } : { ownerId: value }) } : item);
        setOpportunities(next); persist("nikufra:v2:opportunities", next);
        if (supabase) void supabase.from("oportunidades").update(field === "estado" ? { estado: value } : { owner_id: value }).eq("id", opportunity.id).then(({ error }) => { if (error) console.error("Falha ao atualizar atribuição", error.message); });
      }
      if (companyId) {
        setLeads((current) => {
          const next = current.map((lead) => lead.empresaId === companyId ? { ...lead, [field]: value } : lead);
          persist("nikufra:v2:leads", next);
          return next;
        });
      }
    }
  }, [leads, opportunities, persist]);

  const deleteCommercialRecords = useCallback(async (input: { contactIds?: string[]; companyIds?: string[]; opportunityIds?: string[] }) => {
    const contactIds = [...new Set(input.contactIds ?? [])];
    const companyIds = [...new Set(input.companyIds ?? [])];
    const opportunityIds = [...new Set(input.opportunityIds ?? [])];
    if (!contactIds.length && !companyIds.length && !opportunityIds.length) {
      return { deleted: 0, deletedContacts: 0, deletedCompanies: 0, deletedOpportunities: 0, deletedActivities: 0, deletedRevenue: 0, deletedCompanyIds: [] };
    }
    let result: CommercialDeletionResult = {
      deleted: contactIds.length,
      deletedContacts: contactIds.length,
      deletedCompanies: companyIds.length,
      deletedOpportunities: opportunityIds.length,
      deletedActivities: 0,
      deletedRevenue: 0,
      deletedCompanyIds: companyIds,
    };
    if (supabase) {
      const { data, error } = await supabase.functions.invoke("contact-delete", { body: { ids: contactIds, companyIds, opportunityIds } });
      if (error) throw new Error(error.message);
      result = {
        deleted: Number(data?.deleted ?? data?.deleted_contacts ?? 0),
        deletedContacts: Number(data?.deleted_contacts ?? data?.deleted ?? 0),
        deletedCompanies: Number(data?.deleted_companies ?? 0),
        deletedOpportunities: Number(data?.deleted_opportunities ?? 0),
        deletedActivities: Number(data?.deleted_activities ?? 0),
        deletedRevenue: Number(data?.deleted_revenue ?? 0),
        deletedCompanyIds: Array.isArray(data?.deleted_company_ids) ? data.deleted_company_ids : companyIds,
      };
    }
    const pruned = pruneCommercialRecords(
      { leads, opportunities, activities },
      { contactIds, companyIds: result.deletedCompanyIds.length ? result.deletedCompanyIds : companyIds, opportunityIds },
    );
    setLeads(pruned.leads);
    setOpportunities(pruned.opportunities);
    setActivities(pruned.activities);
    persist("nikufra:v2:leads", pruned.leads);
    persist("nikufra:v2:opportunities", pruned.opportunities);
    const deletedCompanyIds = new Set(pruned.companyIds);
    const deletedContactIds = new Set(contactIds);
    setFollowUpSuggestions((current) => current.filter((item) => !deletedCompanyIds.has(item.empresaId) && !deletedContactIds.has(item.contactId)));
    return result;
  }, [activities, leads, opportunities, persist]);

  const value = useMemo(() => ({
    leads,
    opportunities,
    activities,
    followUpSuggestions,
    drafts,
    team,
    currentUserId,
    emailSelection,
    setEmailSelection,
    dataMode: supabase ? "supabase" as const : "local" as const,
    moveOpportunity,
    addOpportunity,
    importBatch,
    updateOpportunity,
    updateLead,
    deleteCommercialRecords,
    addDrafts: (items: Draft[]) => setDrafts((current) => [...items, ...current]),
    addActivity: (item: Activity) => {
      setActivities((current) => [item, ...current]);
      if (supabase) {
        const opportunity = opportunities.find((value) => value.id === item.oportunidadeId);
        if (opportunity?.empresaId) void supabase.from("atividades").insert({ oportunidade_id: item.oportunidadeId || null, empresa_id: opportunity.empresaId, user_id: item.userId, tipo: item.tipo === "email" ? "email_enviado" : item.tipo === "proposta" ? "proposta_enviada" : item.tipo, descricao: item.descricao, data: item.data }).then(({ error }) => { if (error) console.error("Falha ao criar atividade", error.message); });
      }
    },
  }), [activities, addOpportunity, currentUserId, deleteCommercialRecords, drafts, emailSelection, followUpSuggestions, importBatch, leads, moveOpportunity, opportunities, team, updateLead, updateOpportunity]);

  return <CRMContext.Provider value={value}>{children}</CRMContext.Provider>;
}

export function useCRM() {
  const value = useContext(CRMContext);
  if (!value) throw new Error("useCRM deve ser usado dentro de CRMProvider");
  return value;
}
