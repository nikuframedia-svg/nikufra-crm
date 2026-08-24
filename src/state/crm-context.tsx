import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { initialActivities, initialDrafts, initialLeads, initialOpportunities, owners as initialOwners, stageProbability } from "../data/seed";
import { supabase } from "../lib/supabase";
import type { Activity, Draft, Lead, Opportunity, Owner, Stage, Vertical } from "../types";

interface CRMState {
  leads: Lead[];
  opportunities: Opportunity[];
  activities: Activity[];
  drafts: Draft[];
  team: Owner[];
  currentUserId: string;
  emailSelection: string[];
  setEmailSelection: (ids: string[]) => void;
  dataMode: "demo" | "supabase";
  moveOpportunity: (id: string, estado: Stage, loss?: { motivo: string; notas: string }) => void;
  addOpportunity: (opportunity: Opportunity, lead: Lead) => void;
  updateLead: (id: string, field: keyof Lead, value: string) => void;
  addDrafts: (drafts: Draft[]) => void;
  addActivity: (activity: Activity) => void;
}

const CRMContext = createContext<CRMState | null>(null);

const verticalFromDb: Record<string, Vertical> = {
  metalomecanica: "Metalomecânica", automovel: "Automóvel", aluminio: "Alumínio", cortica: "Cortiça", compositos: "Compósitos", eletronica: "Eletrónica", outro: "Metalomecânica",
};
const verticalToDb: Record<Vertical, string> = { "Metalomecânica": "metalomecanica", "Automóvel": "automovel", "Alumínio": "aluminio", "Cortiça": "cortica", "Compósitos": "compositos", "Eletrónica": "eletronica" };
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
  const [leads, setLeads] = useState<Lead[]>(() => readStored("nikufra:leads", initialLeads));
  const [opportunities, setOpportunities] = useState<Opportunity[]>(() => readStored("nikufra:opportunities", initialOpportunities));
  const [activities, setActivities] = useState<Activity[]>(initialActivities);
  const [drafts, setDrafts] = useState<Draft[]>(initialDrafts);
  const [team, setTeam] = useState<Owner[]>(initialOwners);
  const [currentUserId, setCurrentUserId] = useState(initialOwners[0].id);
  const [emailSelection, setEmailSelection] = useState<string[]>([]);

  useEffect(() => {
    if (!supabase) return;
    let active = true;

    async function loadServerState() {
      const [profilesResult, opportunitiesResult, activitiesResult, contactsResult, historyResult] = await Promise.all([
        supabase!.from("profiles").select("id,nome,email,role,cor").eq("ativo", true).order("nome"),
        supabase!.from("oportunidades").select("id,titulo,estado,tipo,valor_estimado,valor_recorrente_anual,probabilidade,owner_id,data_primeiro_contacto,data_prevista_fecho,created_at,updated_at,empresa_id,contacto_principal_id,empresas(id,nome,vertical,cidade,pais,origem)").eq("arquivado", false).order("updated_at", { ascending: false }),
        supabase!.from("atividades").select("id,oportunidade_id,user_id,tipo,descricao,data,empresas(nome)").order("data", { ascending: false }).limit(100),
        supabase!.from("contactos").select("id,empresa_id,nome,cargo,email,telefone,optout,empresas(id,nome,vertical,cidade,pais,origem)").order("updated_at", { ascending: false }),
        supabase!.from("estado_historico").select("oportunidade_id,changed_at").order("changed_at", { ascending: false }),
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
          return { id: row.id, leadId: row.contacto_principal_id ?? row.id, empresaId: row.empresa_id, empresa: company?.nome ?? "Empresa", titulo: row.titulo, estado: row.estado, tipo: opportunityTypeFromDb[row.tipo] ?? "Consultoria", valor: Number(row.valor_estimado), probabilidade: row.probabilidade, ownerId: row.owner_id, diasNoEstado: Math.max(0, Math.round((Date.now() - new Date(enteredAt).getTime()) / 86400000)), dataPrimeiroContacto: row.data_primeiro_contacto ?? "", dataFechoPrevista: row.data_prevista_fecho ?? "", recorrenteAnual: row.valor_recorrente_anual ? Number(row.valor_recorrente_anual) : undefined };
        });
        const serverLeads: Lead[] = (contactsResult.data ?? []).map((contact) => {
          const company = Array.isArray(contact.empresas) ? contact.empresas[0] : contact.empresas;
          const opportunity = opportunitiesResult.data.find((item) => item.contacto_principal_id === contact.id);
          return { id: contact.id, empresaId: contact.empresa_id, nome: contact.nome, cargo: contact.cargo ?? "", empresa: company?.nome ?? "Empresa", email: contact.email ?? "", telefone: contact.telefone ?? "", vertical: verticalFromDb[company?.vertical ?? "outro"], cidade: company?.cidade ?? "", pais: company?.pais ?? "PT", origem: company?.origem ?? "", estado: opportunity?.estado ?? "nao_contactado", ownerId: opportunity?.owner_id ?? profilesResult.data?.[0]?.id ?? initialOwners[0].id, optout: contact.optout } satisfies Lead;
        });
        setOpportunities(serverOpportunities);
        setLeads(serverLeads);
      }
      if (activitiesResult.data) {
        setActivities(activitiesResult.data.map((row) => {
          const companies = row.empresas as { nome: string }[] | { nome: string } | null;
          return { id: row.id, oportunidadeId: row.oportunidade_id ?? "", empresa: (Array.isArray(companies) ? companies[0]?.nome : companies?.nome) ?? "Empresa", userId: row.user_id, tipo: row.tipo === "reuniao" ? "reuniao" : row.tipo === "chamada" ? "chamada" : row.tipo === "proposta_enviada" ? "proposta" : row.tipo === "nota" ? "nota" : "email", descricao: row.descricao, data: row.data };
        }));
      }
    }

    void loadServerState();
    void supabase.auth.getUser().then(({ data }) => { if (data.user) setCurrentUserId(data.user.id); });
    const channel = supabase.channel("crm-live").on("postgres_changes", { event: "*", schema: "public", table: "oportunidades" }, () => void loadServerState()).on("postgres_changes", { event: "*", schema: "public", table: "atividades" }, () => void loadServerState()).subscribe();
    return () => { active = false; void supabase?.removeChannel(channel); };
  }, []);

  const persist = useCallback((key: string, value: unknown) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, []);

  const moveOpportunity = useCallback((id: string, estado: Stage, loss?: { motivo: string; notas: string }) => {
    if (supabase) void supabase.from("oportunidades").update({ estado, ...(estado === "perdido" ? { motivo_perda: loss?.motivo, notas_perda: loss?.notas || null } : {}) }).eq("id", id).then(({ error }) => { if (error) console.error("Falha ao mover oportunidade", error.message); });
    setOpportunities((current) => {
      const next = current.map((item) => item.id === id ? { ...item, estado, probabilidade: stageProbability[estado], diasNoEstado: 0 } : item);
      persist("nikufra:opportunities", next);
      return next;
    });
    setLeads((current) => {
      const opportunity = opportunities.find((item) => item.id === id);
      const next = current.map((lead) => lead.id === opportunity?.leadId ? { ...lead, estado } : lead);
      persist("nikufra:leads", next);
      return next;
    });
  }, [opportunities, persist]);

  const addOpportunity = useCallback((opportunity: Opportunity, lead: Lead) => {
    setOpportunities((current) => {
      const next = [opportunity, ...current];
      persist("nikufra:opportunities", next);
      return next;
    });
    setLeads((current) => {
      const next = [lead, ...current];
      persist("nikufra:leads", next);
      return next;
    });
    if (supabase) void (async () => {
      const { data: company, error: companyError } = await supabase.from("empresas").insert({ nome: lead.empresa, vertical: verticalToDb[lead.vertical], pais: lead.pais || "PT", cidade: lead.cidade || null, origem: "inbound" }).select("id").single();
      if (companyError || !company) { console.error("Falha ao criar empresa", companyError?.message); return; }
      const { error: contactError } = await supabase.from("contactos").insert({ id: lead.id, empresa_id: company.id, nome: lead.nome, cargo: lead.cargo || null, email: lead.email || null, telefone: lead.telefone || null, principal: true });
      if (contactError) { console.error("Falha ao criar contacto", contactError.message); return; }
      const { error: opportunityError } = await supabase.from("oportunidades").insert({ id: opportunity.id, empresa_id: company.id, contacto_principal_id: lead.id, owner_id: opportunity.ownerId, titulo: opportunity.titulo, estado: opportunity.estado, tipo: opportunityTypeToDb[opportunity.tipo], valor_estimado: opportunity.valor, probabilidade: opportunity.probabilidade, data_primeiro_contacto: opportunity.dataPrimeiroContacto || null, data_prevista_fecho: opportunity.dataFechoPrevista || null });
      if (opportunityError) console.error("Falha ao criar oportunidade", opportunityError.message);
    })();
  }, [persist]);

  const updateLead = useCallback((id: string, field: keyof Lead, value: string) => {
    setLeads((current) => {
      const next = current.map((lead) => lead.id === id ? { ...lead, [field]: value } : lead);
      persist("nikufra:leads", next);
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
      const opportunity = opportunities.find((item) => item.leadId === id);
      if (opportunity) {
        const next = opportunities.map((item) => item.id === opportunity.id ? { ...item, ...(field === "estado" ? { estado: value as Stage, probabilidade: stageProbability[value as Stage], diasNoEstado: 0 } : { ownerId: value }) } : item);
        setOpportunities(next); persist("nikufra:opportunities", next);
        if (supabase) void supabase.from("oportunidades").update(field === "estado" ? { estado: value } : { owner_id: value }).eq("id", opportunity.id).then(({ error }) => { if (error) console.error("Falha ao atualizar atribuição", error.message); });
      }
    }
  }, [leads, opportunities, persist]);

  const value = useMemo(() => ({
    leads,
    opportunities,
    activities,
    drafts,
    team,
    currentUserId,
    emailSelection,
    setEmailSelection,
    dataMode: supabase ? "supabase" as const : "demo" as const,
    moveOpportunity,
    addOpportunity,
    updateLead,
    addDrafts: (items: Draft[]) => setDrafts((current) => [...items, ...current]),
    addActivity: (item: Activity) => {
      setActivities((current) => [item, ...current]);
      if (supabase) {
        const opportunity = opportunities.find((value) => value.id === item.oportunidadeId);
        if (opportunity?.empresaId) void supabase.from("atividades").insert({ oportunidade_id: item.oportunidadeId || null, empresa_id: opportunity.empresaId, user_id: item.userId, tipo: item.tipo === "email" ? "email_enviado" : item.tipo === "proposta" ? "proposta_enviada" : item.tipo, descricao: item.descricao, data: item.data }).then(({ error }) => { if (error) console.error("Falha ao criar atividade", error.message); });
      }
    },
  }), [activities, addOpportunity, currentUserId, drafts, emailSelection, leads, moveOpportunity, opportunities, team, updateLead]);

  return <CRMContext.Provider value={value}>{children}</CRMContext.Provider>;
}

export function useCRM() {
  const value = useContext(CRMContext);
  if (!value) throw new Error("useCRM deve ser usado dentro de CRMProvider");
  return value;
}
