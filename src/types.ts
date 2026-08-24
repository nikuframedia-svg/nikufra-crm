export type Stage =
  | "nao_contactado"
  | "contactado"
  | "reuniao_marcada"
  | "reuniao_feita"
  | "proposta"
  | "piloto"
  | "cliente"
  | "perdido"
  | "adiado";

export type Vertical = "Metalomecânica" | "Automóvel" | "Alumínio" | "Cortiça" | "Compósitos" | "Eletrónica";

export interface Owner {
  id: string;
  nome: string;
  email: string;
  iniciais: string;
  cor: string;
  role: "admin" | "member";
}

export interface Lead {
  id: string;
  empresaId?: string;
  nome: string;
  cargo: string;
  empresa: string;
  email: string;
  telefone: string;
  vertical: Vertical;
  cidade: string;
  pais: string;
  origem: string;
  estado: Stage;
  ownerId: string;
  optout?: boolean;
}

export interface Opportunity {
  id: string;
  leadId: string;
  empresaId?: string;
  empresa: string;
  titulo: string;
  estado: Stage;
  tipo: "Consultoria" | "Licença PP1" | "Piloto" | "Misto";
  valor: number;
  probabilidade: number;
  ownerId: string;
  diasNoEstado: number;
  dataPrimeiroContacto: string;
  dataFechoPrevista: string;
  recorrenteAnual?: number;
}

export interface Activity {
  id: string;
  oportunidadeId: string;
  empresa: string;
  userId: string;
  tipo: "email" | "chamada" | "reuniao" | "proposta" | "nota";
  descricao: string;
  data: string;
}

export interface RevenueMonth {
  mes: string;
  contratualizado: number;
  faturado: number;
  recebido: number;
  objetivo: number;
}

export interface Draft {
  id: string;
  destinatario: string;
  empresa: string;
  assunto: string;
  mensagem: string;
  criadoEm: string;
}
