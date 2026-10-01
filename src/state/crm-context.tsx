import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { initialActivities, initialDrafts, initialLeads, initialOpportunities, loadLocalRealData, owners as initialOwners, stageProbability } from "../data/seed";
import { pruneCommercialRecords } from "../lib/crm-records";
import { supabase } from "../lib/supabase";
import type { Activity, CommercialDeletionResult, Draft, FollowUpSuggestion, Lead, Opportunity, OutreachLegalBasis, Owner, Stage, Vertical } from "../types";

interface OutreachComplianceInput {
  legalBasis?: OutreachLegalBasis;
  consentAt?: string;
  consentSource?: string;
  legalBasisEvidence?: string;
  legitimateInterestPurpose?: string;
  liaReference?: string;
  legitimateInterestExpiresAt?: string;
  optout?: boolean;
}

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
  moveOpportunity: (id: string, estado: Stage, loss?: { motivo: string; notas: string; valorProposta: number }) => Promise<void>;
  addOpportunity: (opportunity: Opportunity, lead: Lead) => void;
  importBatch: (leads: Lead[], opportunities: Opportunity[], options?: { includeNikufraFinancials?: boolean }) => Promise<void>;
  updateOpportunity: (id: string, changes: Partial<Opportunity>) => void;
  updateCompanyName: (companyId: string, name: string) => Promise<void>;
  updateLead: (id: string, field: keyof Lead, value: string) => void;
  updateLeadOutreachCompliance: (id: string, input: OutreachComplianceInput) => Promise<void>;
  deleteCommercialRecords: (input: { contactIds?: string[]; companyIds?: string[]; opportunityIds?: string[] }) => Promise<CommercialDeletionResult>;
  dismissFollowUpSuggestion: (contactId: string) => Promise<void>;
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
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isDatabaseUserId(value: string | undefined | null): value is string {
  return Boolean(value && UUID_PATTERN.test(value));
}

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
  const [team, setTeam] = useState<Owner[]>(() => supabase ? [] : initialOwners);
  const [currentUserId, setCurrentUserId] = useState(() => supabase ? "" : initialOwners[0].id);
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
      const [profilesResult, opportunitiesResult, activitiesResult, contactsResult, historyResult, suggestionsResult, proposalPricesResult] = await Promise.all([
        supabase!.from("profiles").select("id,nome,email,role,cor,outreach_role").eq("ativo", true).order("nome"),
        supabase!.from("oportunidades").select("id,titulo,estado,tipo,valor_estimado,valor_recorrente_anual,probabilidade,owner_id,data_primeiro_contacto,data_reuniao,data_proposta,data_piloto,data_fecho,data_prevista_fecho,ciclo_acordo_meses,avaliacao,notas,created_at,updated_at,empresa_id,contacto_principal_id,empresas(id,nome,vertical,cidade,pais,origem)").eq("arquivado", false).order("updated_at", { ascending: false }),
        supabase!.from("atividades").select("id,oportunidade_id,contacto_id,user_id,tipo,descricao,data,direcao,reuniao_inferida,thread_id,assunto,snippet,empresas(nome),contactos(nome,email)").order("data", { ascending: false }).limit(500),
        supabase!.from("contactos").select("id,empresa_id,nome,cargo,email,telefone,optout,outreach_legal_basis,outreach_consent_at,outreach_consent_source,outreach_legal_basis_evidence,outreach_legal_basis_recorded_at,outreach_legal_basis_recorded_by,outreach_legitimate_interest_purpose,outreach_lia_reference,outreach_legitimate_interest_expires_at,estado,data_reuniao,empresas(id,nome,vertical,cidade,pais,origem)").order("updated_at", { ascending: false }),
        supabase!.from("estado_historico").select("oportunidade_id,changed_at").order("changed_at", { ascending: false }),
        supabase!.from("follow_up_suggestions").select("contact_id,empresa_id,opportunity_id,owner_id,user_id,empresa,contacto_nome,contacto_email,contacto_cargo,estado,ultima_interacao_em,total_interacoes,total_mensagens,emails_enviados,emails_recebidos,reunioes,ultimo_assunto,ultimo_resumo").eq("user_id", activeUserId ?? "00000000-0000-0000-0000-000000000000"),
        // Kept separate so an app preview can still load against the previous schema before migration.
        supabase!.from("oportunidades").select("id,valor_proposta").eq("arquivado", false),
      ]);
      if (!active) return;
      if (profilesResult.data?.length) {
        setTeam(profilesResult.data.map((profile) => ({ id: profile.id, nome: profile.nome, email: profile.email, iniciais: profile.nome.split(" ").map((part: string) => part[0]).slice(0, 2).join(""), cor: profile.cor, role: profile.role, outreachRole: profile.outreach_role })));
      }
      if (opportunitiesResult.error) console.error("Falha ao carregar oportunidades", opportunitiesResult.error.message);
      if (opportunitiesResult.data) {
        const latestStateChange = new Map<string, string>();
        for (const row of historyResult.data ?? []) if (!latestStateChange.has(row.oportunidade_id)) latestStateChange.set(row.oportunidade_id, row.changed_at);
        const proposalPriceByOpportunity = new Map((proposalPricesResult.data ?? []).map((row) => [row.id, row.valor_proposta]));
        const serverOpportunities: Opportunity[] = opportunitiesResult.data.map((row) => {
          const company = Array.isArray(row.empresas) ? row.empresas[0] : row.empresas;
          const enteredAt = latestStateChange.get(row.id) ?? row.created_at;
          const proposalPrice = proposalPriceByOpportunity.get(row.id);
          return { id: row.id, leadId: row.contacto_principal_id ?? row.id, empresaId: row.empresa_id, empresa: company?.nome ?? "Empresa", titulo: row.titulo, estado: row.estado, tipo: opportunityTypeFromDb[row.tipo] ?? "Consultoria", valor: Number(row.valor_estimado), probabilidade: row.probabilidade, ownerId: row.owner_id, diasNoEstado: Math.max(0, Math.floor((Date.now() - new Date(enteredAt).getTime()) / 86400000)), dataPrimeiroContacto: row.data_primeiro_contacto ?? "", dataReuniao: row.data_reuniao ?? undefined, dataProposta: row.data_proposta ?? undefined, dataPiloto: row.data_piloto ?? undefined, dataFecho: row.data_fecho ?? undefined, dataFechoPrevista: row.data_prevista_fecho ?? "", cicloAcordoMeses: row.ciclo_acordo_meses == null ? undefined : Number(row.ciclo_acordo_meses), recorrenteAnual: row.valor_recorrente_anual ? Number(row.valor_recorrente_anual) : undefined, valorProposta: proposalPrice == null ? undefined : Number(proposalPrice), avaliacao: row.avaliacao ?? undefined, notas: row.notas ?? "" };
        });
        const serverLeads: Lead[] = (contactsResult.data ?? []).map((contact) => {
          const company = Array.isArray(contact.empresas) ? contact.empresas[0] : contact.empresas;
          const opportunity = opportunitiesResult.data.find((item) => item.empresa_id === contact.empresa_id);
          return { id: contact.id, empresaId: contact.empresa_id, nome: contact.nome, cargo: contact.cargo ?? "", empresa: company?.nome ?? "Empresa", email: contact.email ?? "", telefone: contact.telefone ?? "", vertical: verticalFromDb[company?.vertical ?? "outro"], cidade: company?.cidade ?? "", pais: company?.pais ?? "PT", origem: company?.origem ?? "", estado: opportunity?.estado ?? contact.estado ?? "nao_contactado", ownerId: opportunity?.owner_id ?? activeUserId ?? profilesResult.data?.[0]?.id ?? "", optout: contact.optout, outreachLegalBasis: contact.outreach_legal_basis ?? undefined, outreachConsentAt: contact.outreach_consent_at ?? undefined, outreachConsentSource: contact.outreach_consent_source ?? undefined, outreachLegalBasisEvidence: contact.outreach_legal_basis_evidence ?? undefined, outreachLegalBasisRecordedAt: contact.outreach_legal_basis_recorded_at ?? undefined, outreachLegalBasisRecordedBy: contact.outreach_legal_basis_recorded_by ?? undefined, outreachLegitimateInterestPurpose: contact.outreach_legitimate_interest_purpose ?? undefined, outreachLiaReference: contact.outreach_lia_reference ?? undefined, outreachLegitimateInterestExpiresAt: contact.outreach_legitimate_interest_expires_at ?? undefined, dataReuniao: contact.data_reuniao ?? undefined } satisfies Lead;
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
    const channel = supabase.channel("crm-live").on("postgres_changes", { event: "*", schema: "public", table: "oportunidades" }, () => void loadServerState()).on("postgres_changes", { event: "*", schema: "public", table: "atividades" }, () => void loadServerState()).on("postgres_changes", { event: "*", schema: "public", table: "contactos" }, () => void loadServerState()).on("postgres_changes", { event: "*", schema: "public", table: "empresas" }, () => void loadServerState()).subscribe();
    return () => { active = false; void supabase?.removeChannel(channel); };
  }, []);

  const persist = useCallback((key: string, value: unknown) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, []);

  const moveOpportunity = useCallback(async (id: string, estado: Stage, loss?: { motivo: string; notas: string; valorProposta: number }) => {
    if (estado === "perdido" && (!loss?.motivo || !Number.isFinite(loss.valorProposta) || loss.valorProposta < 0)) {
      throw new Error("Indica o motivo e um preço de proposta válido (0 quando não houve proposta).");
    }
    if (supabase) {
      const { error } = await supabase.from("oportunidades").update({ estado, ...(estado === "perdido" ? { motivo_perda: loss!.motivo, notas_perda: loss!.notas || null, valor_proposta: loss!.valorProposta } : {}) }).eq("id", id);
      if (error) throw new Error(error.message);
    }
    setOpportunities((current) => {
      const next = current.map((item) => item.id === id ? { ...item, estado, probabilidade: stageProbability[estado], diasNoEstado: 0, ...(estado === "perdido" ? { valorProposta: loss!.valorProposta } : {}) } : item);
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
    const databaseOwnerId = isDatabaseUserId(opportunity.ownerId)
      ? opportunity.ownerId
      : isDatabaseUserId(currentUserId) ? currentUserId : null;
    if (supabase && !databaseOwnerId) {
      console.error("A oportunidade não foi criada: ainda não existe um responsável CRM válido.");
      return;
    }
    const safeOpportunity = databaseOwnerId ? { ...opportunity, ownerId: databaseOwnerId } : opportunity;
    const safeLead = databaseOwnerId ? { ...lead, ownerId: databaseOwnerId } : lead;
    setOpportunities((current) => {
      const next = [safeOpportunity, ...current];
      persist("nikufra:v2:opportunities", next);
      return next;
    });
    setLeads((current) => {
      const next = [safeLead, ...current];
      persist("nikufra:v2:leads", next);
      return next;
    });
    if (supabase) void (async () => {
      const { data: company, error: companyError } = await supabase.from("empresas").insert({ nome: safeLead.empresa, vertical: verticalToDb[safeLead.vertical], pais: safeLead.pais || "PT", cidade: safeLead.cidade || null, origem: "inbound" }).select("id").single();
      if (companyError || !company) { console.error("Falha ao criar empresa", companyError?.message); return; }
      const { error: contactError } = await supabase.from("contactos").insert({ id: safeLead.id, empresa_id: company.id, nome: safeLead.nome, cargo: safeLead.cargo || null, email: safeLead.email || null, telefone: safeLead.telefone || null, principal: true, estado: safeLead.estado, data_reuniao: safeLead.dataReuniao || null });
      if (contactError) { console.error("Falha ao criar contacto", contactError.message); return; }
      const { error: opportunityError } = await supabase.from("oportunidades").insert({ id: safeOpportunity.id, empresa_id: company.id, contacto_principal_id: safeLead.id, owner_id: databaseOwnerId, titulo: safeOpportunity.titulo, estado: safeOpportunity.estado, tipo: opportunityTypeToDb[safeOpportunity.tipo], valor_estimado: safeOpportunity.valor, probabilidade: safeOpportunity.probabilidade, data_primeiro_contacto: safeOpportunity.dataPrimeiroContacto || null, data_prevista_fecho: safeOpportunity.dataFechoPrevista || null });
      if (opportunityError) console.error("Falha ao criar oportunidade", opportunityError.message);
    })();
  }, [currentUserId, persist]);

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
    if (changes.valorProposta !== undefined) payload.valor_proposta = changes.valorProposta;
    if (changes.ownerId !== undefined && isDatabaseUserId(changes.ownerId)) payload.owner_id = changes.ownerId;
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

  const updateCompanyName = useCallback(async (companyId: string, name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) throw new Error("O nome da empresa é obrigatório.");
    if (supabase) {
      const { error } = await supabase.from("empresas").update({ nome: trimmedName }).eq("id", companyId);
      if (error) throw new Error(error.message);
    }
    const previousName = opportunities.find((item) => item.empresaId === companyId || item.id === companyId)?.empresa
      ?? leads.find((lead) => lead.empresaId === companyId)?.empresa;
    setLeads((current) => {
      const next = current.map((lead) => lead.empresaId === companyId || (!lead.empresaId && lead.empresa === previousName) ? { ...lead, empresa: trimmedName } : lead);
      persist("nikufra:v2:leads", next);
      return next;
    });
    setOpportunities((current) => {
      const next = current.map((item) => item.empresaId === companyId || item.id === companyId || (!item.empresaId && item.empresa === previousName) ? { ...item, empresa: trimmedName } : item);
      persist("nikufra:v2:opportunities", next);
      return next;
    });
    setActivities((current) => current.map((item) => item.empresa === previousName ? { ...item, empresa: trimmedName } : item));
    setFollowUpSuggestions((current) => current.map((item) => item.empresaId === companyId ? { ...item, empresa: trimmedName } : item));
  }, [leads, opportunities, persist]);

  const updateLead = useCallback((id: string, field: keyof Lead, value: string) => {
    const companyId = leads.find((lead) => lead.id === id)?.empresaId;
    if (field === "empresa" && companyId) {
      const previousName = leads.find((lead) => lead.empresaId === companyId)?.empresa;
      setLeads((current) => {
        const next = current.map((lead) => lead.empresaId === companyId ? { ...lead, empresa: value } : lead);
        persist("nikufra:v2:leads", next);
        return next;
      });
      setOpportunities((current) => {
        const next = current.map((item) => item.empresaId === companyId ? { ...item, empresa: value } : item);
        persist("nikufra:v2:opportunities", next);
        return next;
      });
      setActivities((current) => current.map((item) => item.empresa === previousName ? { ...item, empresa: value } : item));
      setFollowUpSuggestions((current) => current.map((item) => item.empresaId === companyId ? { ...item, empresa: value } : item));
      if (supabase) void supabase.from("empresas").update({ nome: value }).eq("id", companyId).then(({ error }) => { if (error) console.error("Falha ao editar empresa", error.message); });
      return;
    }
    setLeads((current) => {
      const next = current.map((lead) => lead.id === id ? { ...lead, [field]: value } : lead);
      persist("nikufra:v2:leads", next);
      return next;
    });
    if (supabase && ["nome", "cargo", "email", "telefone"].includes(field)) {
      void supabase.from("contactos").update({ [field]: value }).eq("id", id).then(({ error }) => { if (error) console.error("Falha ao editar contacto", error.message); });
    }
    if (field === "vertical") {
      if (supabase && companyId) void supabase.from("empresas").update({ vertical: verticalToDb[value as Vertical] }).eq("id", companyId).then(({ error }) => { if (error) console.error("Falha ao editar vertical", error.message); });
    }
    if (field === "ownerId" && supabase && !isDatabaseUserId(value)) return;
    if (field === "estado" || field === "ownerId") {
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

  const updateLeadOutreachCompliance = useCallback(async (id: string, input: OutreachComplianceInput) => {
    const legalBasis = input.legalBasis || undefined;
    const consentAt = legalBasis === "consent" ? input.consentAt?.trim() : undefined;
    const consentSource = legalBasis === "consent" ? input.consentSource?.trim() : undefined;
    const legalBasisEvidence = legalBasis === "contract" ? input.legalBasisEvidence?.trim() : undefined;
    const legitimateInterestPurpose = legalBasis === "legitimate_interest" ? input.legitimateInterestPurpose?.trim() : undefined;
    const liaReference = legalBasis === "legitimate_interest" ? input.liaReference?.trim() : undefined;
    const legitimateInterestExpiresAt = legalBasis === "legitimate_interest" ? input.legitimateInterestExpiresAt?.trim() : undefined;
    if (legalBasis === "consent" && (!consentAt || !consentSource)) {
      throw new Error("Consentimento exige data e origem documental.");
    }
    if (legalBasis === "contract" && !legalBasisEvidence) {
      throw new Error("Execução de contrato exige uma referência documental.");
    }
    if (legalBasis === "legitimate_interest" && (!legitimateInterestPurpose || !liaReference || !legitimateInterestExpiresAt)) {
      throw new Error("Interesse legítimo exige finalidade, referência LIA e validade.");
    }
    if (supabase) {
      const payload: Record<string, unknown> = {
        outreach_legal_basis: legalBasis ?? null,
        outreach_consent_at: consentAt || null,
        outreach_consent_source: consentSource || null,
        outreach_legal_basis_evidence: legalBasisEvidence || null,
        outreach_legitimate_interest_purpose: legitimateInterestPurpose || null,
        outreach_lia_reference: liaReference || null,
        outreach_legitimate_interest_expires_at: legitimateInterestExpiresAt || null,
      };
      if (input.optout) payload.optout = true;
      const { error } = await supabase.from("contactos").update(payload).eq("id", id);
      if (error) throw new Error(error.message);
    }
    setLeads((current) => {
      const next = current.map((lead) => lead.id === id ? {
        ...lead,
        outreachLegalBasis: legalBasis,
        outreachConsentAt: consentAt,
        outreachConsentSource: consentSource,
        outreachLegalBasisEvidence: legalBasisEvidence,
        outreachLegalBasisRecordedAt: legalBasis ? new Date().toISOString() : undefined,
        outreachLegalBasisRecordedBy: legalBasis ? currentUserId : undefined,
        outreachLegitimateInterestPurpose: legitimateInterestPurpose,
        outreachLiaReference: liaReference,
        outreachLegitimateInterestExpiresAt: legitimateInterestExpiresAt,
        optout: input.optout ? true : lead.optout,
      } : lead);
      persist("nikufra:v2:leads", next);
      return next;
    });
  }, [currentUserId, persist]);

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

  const dismissFollowUpSuggestion = useCallback(async (contactId: string) => {
    if (supabase) {
      const { error } = await supabase.from("follow_up_dismissals").upsert({ user_id: currentUserId, contact_id: contactId }, { onConflict: "user_id,contact_id" });
      if (error) throw new Error(error.message);
    } else {
      const storageKey = `nikufra:v2:follow-up-dismissals:${currentUserId}`;
      const dismissed = new Set(readStored<string[]>(storageKey, []));
      dismissed.add(contactId);
      persist(storageKey, [...dismissed]);
    }
    setFollowUpSuggestions((current) => current.filter((item) => item.contactId !== contactId || item.userId !== currentUserId));
  }, [currentUserId, persist]);

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
    updateCompanyName,
    updateLead,
    updateLeadOutreachCompliance,
    deleteCommercialRecords,
    dismissFollowUpSuggestion,
    addDrafts: (items: Draft[]) => setDrafts((current) => [...items, ...current]),
    addActivity: (item: Activity) => {
      setActivities((current) => [item, ...current]);
      if (supabase) {
        const opportunity = opportunities.find((value) => value.id === item.oportunidadeId);
        if (opportunity?.empresaId) void supabase.from("atividades").insert({ oportunidade_id: item.oportunidadeId || null, empresa_id: opportunity.empresaId, user_id: item.userId, tipo: item.tipo === "email" ? "email_enviado" : item.tipo === "proposta" ? "proposta_enviada" : item.tipo, descricao: item.descricao, data: item.data }).then(({ error }) => { if (error) console.error("Falha ao criar atividade", error.message); });
      }
    },
  }), [activities, addOpportunity, currentUserId, deleteCommercialRecords, dismissFollowUpSuggestion, drafts, emailSelection, followUpSuggestions, importBatch, leads, moveOpportunity, opportunities, team, updateCompanyName, updateLead, updateLeadOutreachCompliance, updateOpportunity]);

  return <CRMContext.Provider value={value}>{children}</CRMContext.Provider>;
}

export function useCRM() {
  const value = useContext(CRMContext);
  if (!value) throw new Error("useCRM deve ser usado dentro de CRMProvider");
  return value;
}
