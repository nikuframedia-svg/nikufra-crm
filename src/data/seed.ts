import type { Activity, Draft, Lead, Opportunity, Owner, RevenueMonth, Stage } from "../types";

export const stageOrder: Stage[] = [
  "nao_contactado",
  "contactado",
  "reuniao_marcada",
  "reuniao_feita",
  "proposta",
  "piloto",
  "cliente",
];

export const stageLabels: Record<Stage, string> = {
  nao_contactado: "Não contactado",
  contactado: "Contactado",
  reuniao_marcada: "Reunião marcada",
  reuniao_feita: "Reunião feita",
  proposta: "Proposta",
  piloto: "Piloto",
  cliente: "Cliente",
  perdido: "Perdido",
  adiado: "Adiado",
};

export const stageProbability: Record<Stage, number> = {
  nao_contactado: 0,
  contactado: 5,
  reuniao_marcada: 15,
  reuniao_feita: 30,
  proposta: 50,
  piloto: 75,
  cliente: 100,
  perdido: 0,
  adiado: 10,
};

export const owners: Owner[] = [
  { id: "o1", nome: "João Milhazes", email: "joao@nikufra.ai", iniciais: "JM", cor: "#3b82f6", role: "admin" },
  { id: "o2", nome: "Marta Silva", email: "marta@nikufra.ai", iniciais: "MS", cor: "#8b5cf6", role: "member" },
  { id: "o3", nome: "Tomás Costa", email: "tomas@nikufra.ai", iniciais: "TC", cor: "#14b8a6", role: "member" },
  { id: "o4", nome: "Inês Rocha", email: "ines@nikufra.ai", iniciais: "IR", cor: "#f59e0b", role: "member" },
];

export const initialLeads: Lead[] = [
  { id: "l1", nome: "Rui Correia", cargo: "Diretor de Operações", empresa: "Ferrovia Norte", email: "rui.correia@ferrovianorte.pt", telefone: "+351 912 304 118", vertical: "Metalomecânica", cidade: "Braga", pais: "PT", origem: "Referência", estado: "proposta", ownerId: "o1" },
  { id: "l2", nome: "Ana Faria", cargo: "Diretora Industrial", empresa: "Alumitech", email: "ana.faria@alumitech.pt", telefone: "+351 934 820 442", vertical: "Alumínio", cidade: "Aveiro", pais: "PT", origem: "Evento", estado: "piloto", ownerId: "o2" },
  { id: "l3", nome: "Pedro Leal", cargo: "Plant Manager", empresa: "Moldes Atlas", email: "pedro.leal@moldesatlas.pt", telefone: "+351 919 772 360", vertical: "Automóvel", cidade: "Marinha Grande", pais: "PT", origem: "LinkedIn", estado: "reuniao_feita", ownerId: "o3" },
  { id: "l4", nome: "Sofia Martins", cargo: "CIO", empresa: "Corkline", email: "sofia.martins@corkline.pt", telefone: "+351 962 117 905", vertical: "Cortiça", cidade: "Santa Maria da Feira", pais: "PT", origem: "Inbound", estado: "cliente", ownerId: "o1" },
  { id: "l5", nome: "Luís Amaral", cargo: "Responsável de Melhoria", empresa: "Tecnoval Components", email: "luis.amaral@tecnoval.eu", telefone: "+351 913 600 271", vertical: "Automóvel", cidade: "Vila Nova de Famalicão", pais: "PT", origem: "Email outbound", estado: "contactado", ownerId: "o4" },
  { id: "l6", nome: "Mónica Santos", cargo: "COO", empresa: "CarbonForm", email: "monica.santos@carbonform.es", telefone: "+34 610 442 083", vertical: "Compósitos", cidade: "Vigo", pais: "ES", origem: "Rede pessoal", estado: "reuniao_marcada", ownerId: "o2" },
  { id: "l7", nome: "André Melo", cargo: "Diretor de Produção", empresa: "Elecwave", email: "andre.melo@elecwave.pt", telefone: "+351 968 044 517", vertical: "Eletrónica", cidade: "Maia", pais: "PT", origem: "Evento", estado: "nao_contactado", ownerId: "o3" },
  { id: "l8", nome: "Teresa Sousa", cargo: "Diretora Geral", empresa: "Maquinorte", email: "teresa.sousa@maquinorte.pt", telefone: "+351 916 588 930", vertical: "Metalomecânica", cidade: "Guimarães", pais: "PT", origem: "Referência", estado: "proposta", ownerId: "o4" },
  { id: "l9", nome: "Daniel Pires", cargo: "Head of Data", empresa: "Autovia Systems", email: "daniel.pires@autovia.de", telefone: "+49 152 840 318", vertical: "Automóvel", cidade: "Stuttgart", pais: "DE", origem: "LinkedIn", estado: "piloto", ownerId: "o1" },
  { id: "l10", nome: "Clara Esteves", cargo: "Operations Excellence", empresa: "LusoCork", email: "clara.esteves@lusocork.pt", telefone: "+351 932 488 156", vertical: "Cortiça", cidade: "Espinho", pais: "PT", origem: "Email outbound", estado: "contactado", ownerId: "o2" },
  { id: "l11", nome: "Miguel Barros", cargo: "CEO", empresa: "Precision Tooling", email: "miguel.barros@precisiontooling.pt", telefone: "+351 961 600 213", vertical: "Metalomecânica", cidade: "Oliveira de Azeméis", pais: "PT", origem: "Inbound", estado: "cliente", ownerId: "o3" },
  { id: "l12", nome: "Laura Viana", cargo: "Diretora de Sistemas", empresa: "Circuita", email: "laura.viana@circuita.fr", telefone: "+33 688 210 552", vertical: "Eletrónica", cidade: "Lyon", pais: "FR", origem: "Evento", estado: "reuniao_feita", ownerId: "o4" },
  { id: "l13", nome: "Ricardo Neves", cargo: "Industrial Engineer", empresa: "Extrusal Tech", email: "ricardo.neves@extrusaltech.pt", telefone: "+351 918 441 027", vertical: "Alumínio", cidade: "Setúbal", pais: "PT", origem: "LinkedIn", estado: "nao_contactado", ownerId: "o1" },
  { id: "l14", nome: "Isabel Freitas", cargo: "CFO", empresa: "Metaloeste", email: "isabel.freitas@metaloeste.pt", telefone: "+351 935 122 619", vertical: "Metalomecânica", cidade: "Leiria", pais: "PT", origem: "Referência", estado: "adiado", ownerId: "o2" },
  { id: "l15", nome: "Nuno Tavares", cargo: "Plant Director", empresa: "E-Motion Parts", email: "nuno.tavares@emotionparts.pt", telefone: "+351 969 812 004", vertical: "Automóvel", cidade: "Palmela", pais: "PT", origem: "Email outbound", estado: "perdido", ownerId: "o3" },
];

export const initialOpportunities: Opportunity[] = initialLeads.map((lead, index) => {
  const values = [68000, 92000, 45000, 120000, 34000, 56000, 28000, 76000, 145000, 41000, 88000, 64000, 39000, 72000, 52000];
  const days = [18, 7, 12, 42, 4, 9, 2, 34, 21, 6, 68, 16, 1, 47, 33];
  const types: Opportunity["tipo"][] = ["Misto", "Piloto", "Consultoria", "Licença PP1"];
  return {
    id: `opp-${index + 1}`,
    leadId: lead.id,
    empresa: lead.empresa,
    titulo: index % 3 === 0 ? "Sistema de planeamento inteligente" : index % 3 === 1 ? "Arquitetura de dados industrial" : "Otimização preditiva de produção",
    estado: lead.estado,
    tipo: types[index % types.length],
    valor: values[index],
    probabilidade: stageProbability[lead.estado],
    ownerId: lead.ownerId,
    diasNoEstado: days[index],
    dataPrimeiroContacto: `2025-${String(((index + 4) % 12) + 1).padStart(2, "0")}-${String((index % 24) + 1).padStart(2, "0")}`,
    dataFechoPrevista: `2026-${String(((index + 7) % 12) + 1).padStart(2, "0")}-20`,
    recorrenteAnual: lead.estado === "cliente" || lead.estado === "piloto" ? Math.round(values[index] * 0.28) : undefined,
  };
});

export const initialActivities: Activity[] = [
  { id: "a1", oportunidadeId: "opp-1", empresa: "Ferrovia Norte", userId: "o1", tipo: "proposta", descricao: "Proposta revista enviada — inclui fase de descoberta de 3 semanas.", data: "2026-08-24T09:18:00Z" },
  { id: "a2", oportunidadeId: "opp-2", empresa: "Alumitech", userId: "o2", tipo: "reuniao", descricao: "Reunião de checkpoint do piloto. OEE validado pela equipa industrial.", data: "2026-08-23T15:30:00Z" },
  { id: "a3", oportunidadeId: "opp-6", empresa: "CarbonForm", userId: "o2", tipo: "email", descricao: "Agenda e contexto técnico enviados para a reunião de quinta-feira.", data: "2026-08-23T11:05:00Z" },
  { id: "a4", oportunidadeId: "opp-9", empresa: "Autovia Systems", userId: "o1", tipo: "chamada", descricao: "Definido acesso aos dados MES e interlocutor do lado do cliente.", data: "2026-08-22T16:40:00Z" },
  { id: "a5", oportunidadeId: "opp-12", empresa: "Circuita", userId: "o4", tipo: "reuniao", descricao: "Descoberta: principal dor é previsão de atrasos em ordens críticas.", data: "2026-08-22T10:00:00Z" },
  { id: "a6", oportunidadeId: "opp-11", empresa: "Precision Tooling", userId: "o3", tipo: "nota", descricao: "Cliente pediu extensão do dashboard a uma segunda unidade fabril.", data: "2026-08-21T14:12:00Z" },
];

export const revenueMonths: RevenueMonth[] = [
  { mes: "Set", contratualizado: 26000, faturado: 18000, recebido: 15000, objetivo: 25000 },
  { mes: "Out", contratualizado: 34000, faturado: 22000, recebido: 19000, objetivo: 25000 },
  { mes: "Nov", contratualizado: 28000, faturado: 31000, recebido: 27000, objetivo: 27000 },
  { mes: "Dez", contratualizado: 46000, faturado: 38000, recebido: 33000, objetivo: 30000 },
  { mes: "Jan", contratualizado: 32000, faturado: 26000, recebido: 22000, objetivo: 30000 },
  { mes: "Fev", contratualizado: 39000, faturado: 29000, recebido: 28000, objetivo: 30000 },
  { mes: "Mar", contratualizado: 51000, faturado: 44000, recebido: 37000, objetivo: 32000 },
  { mes: "Abr", contratualizado: 48000, faturado: 41000, recebido: 39000, objetivo: 32000 },
  { mes: "Mai", contratualizado: 62000, faturado: 49000, recebido: 46000, objetivo: 35000 },
  { mes: "Jun", contratualizado: 55000, faturado: 52000, recebido: 48000, objetivo: 35000 },
  { mes: "Jul", contratualizado: 71000, faturado: 58000, recebido: 54000, objetivo: 38000 },
  { mes: "Ago", contratualizado: 64000, faturado: 61000, recebido: 57000, objetivo: 40000 },
];

export const initialDrafts: Draft[] = [
  { id: "d1", destinatario: "rui.correia@ferrovianorte.pt", empresa: "Ferrovia Norte", assunto: "Próximos passos — Nikufra × Ferrovia Norte", mensagem: "Olá Rui,\n\nDeixo alinhados os próximos passos que discutimos...", criadoEm: "Hoje, 10:42" },
  { id: "d2", destinatario: "monica.santos@carbonform.es", empresa: "CarbonForm", assunto: "Contexto para a nossa reunião", mensagem: "Olá Mónica,\n\nAntes da nossa reunião, partilho o enquadramento...", criadoEm: "Ontem, 16:08" },
];

export const conversionData = [
  { etapa: "Contactado", total: 34, taxa: 100 },
  { etapa: "Reunião marcada", total: 23, taxa: 68 },
  { etapa: "Reunião feita", total: 19, taxa: 83 },
  { etapa: "Proposta", total: 13, taxa: 68 },
  { etapa: "Piloto", total: 8, taxa: 62 },
  { etapa: "Cliente", total: 6, taxa: 75 },
];

export const cohortData = [
  { mes: "Jan", reuniao: 44, proposta: 22, cliente: 11 },
  { mes: "Fev", reuniao: 50, proposta: 29, cliente: 14 },
  { mes: "Mar", reuniao: 57, proposta: 31, cliente: 18 },
  { mes: "Abr", reuniao: 53, proposta: 35, cliente: 18 },
  { mes: "Mai", reuniao: 62, proposta: 38, cliente: 23 },
  { mes: "Jun", reuniao: 68, proposta: 42, cliente: 26 },
  { mes: "Jul", reuniao: 64, proposta: 45, cliente: 27 },
  { mes: "Ago", reuniao: 71, proposta: 48, cliente: 29 },
];
