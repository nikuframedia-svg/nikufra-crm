import type { Owner } from "../types";

export type ChatConversationKind = "channel" | "direct" | "group";

export interface ChatConversation {
  id: string;
  kind: ChatConversationKind;
  nome: string | null;
  descricao: string;
  privado: boolean;
  createdBy: string;
  lastMessageAt: string;
  createdAt: string;
}

export interface ChatMember {
  conversationId: string;
  userId: string;
  role: "owner" | "member";
  lastReadAt: string;
}

export interface ChatAgent {
  id: string;
  nome: string;
  descricao: string;
  provider: "anthropic";
  model: string;
  instrucoes: string;
  ativo: boolean;
}

export interface ChatConversationAgent {
  conversationId: string;
  agentId: string;
  ativo: boolean;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string | null;
  agentId: string | null;
  parentMessageId: string | null;
  body: string;
  editedAt: string | null;
  createdAt: string;
}

export function chatConversationTitle(conversation: ChatConversation, members: ChatMember[], team: Owner[], currentUserId: string) {
  if (conversation.kind === "channel") return conversation.nome ?? "Canal";
  if (conversation.nome) return conversation.nome;
  const names = members
    .filter((member) => member.conversationId === conversation.id && member.userId !== currentUserId)
    .map((member) => team.find((person) => person.id === member.userId)?.nome)
    .filter((name): name is string => Boolean(name));
  return names.join(", ") || "Conversa";
}

export function chatConversationInitials(title: string) {
  return title.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join("").toUpperCase() || "#";
}

export function mentionedAgentIds(body: string, agents: ChatAgent[]) {
  const normalized = body.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return agents.filter((agent) => {
    const mention = agent.nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return normalized.includes(`@${mention}`);
  }).map((agent) => agent.id);
}

export function formatChatTime(value: string, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  if (date.toDateString() === now.toDateString()) return new Intl.DateTimeFormat("pt-PT", { hour: "2-digit", minute: "2-digit" }).format(date);
  return new Intl.DateTimeFormat("pt-PT", { day: "2-digit", month: "short" }).format(date);
}
