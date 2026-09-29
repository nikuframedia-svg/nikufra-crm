import { describe, expect, it } from "vitest";
import { chatConversationInitials, chatConversationTitle, mentionedAgentIds, type ChatAgent, type ChatConversation, type ChatMember } from "./chat";
import type { Owner } from "../types";

const conversation: ChatConversation = { id: "c1", kind: "direct", nome: null, descricao: "", privado: true, createdBy: "u1", lastMessageAt: "2026-09-29T10:00:00Z", createdAt: "2026-09-29T10:00:00Z" };
const members: ChatMember[] = [
  { conversationId: "c1", userId: "u1", role: "owner", lastReadAt: "2026-09-29T10:00:00Z" },
  { conversationId: "c1", userId: "u2", role: "member", lastReadAt: "2026-09-29T10:00:00Z" },
];
const team: Owner[] = [
  { id: "u1", nome: "João Milhazes", email: "joao@nikufra.ai", iniciais: "JM", cor: "#2563eb", role: "admin" },
  { id: "u2", nome: "Mateus Silva", email: "mateus@nikufra.ai", iniciais: "MS", cor: "#16a34a", role: "member" },
];

describe("chat helpers", () => {
  it("names direct conversations after the other participant", () => {
    expect(chatConversationTitle(conversation, members, team, "u1")).toBe("Mateus Silva");
  });

  it("creates stable two-letter initials", () => {
    expect(chatConversationInitials("Equipa comercial")).toBe("EC");
  });

  it("finds explicit agent mentions without depending on accents or case", () => {
    const agents: ChatAgent[] = [{ id: "a1", nome: "Claude Vendas", descricao: "", provider: "anthropic", model: "claude-sonnet-5", instrucoes: "", ativo: true }];
    expect(mentionedAgentIds("@claude vendas resume isto", agents)).toEqual(["a1"]);
  });
});
