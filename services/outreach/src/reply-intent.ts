import type { InboundProviderMessage } from "./types.js";

function freshReplyText(text: string) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const fresh: string[] = [];
  for (const line of lines) {
    const value = line.trim();
    if (/^(?:on|em)\s+.+(?:wrote|escreveu):\s*$/i.test(value) || /^-{2,}\s*(?:original message|mensagem original|forwarded message)\s*-{2,}$/i.test(value)) break;
    if (!value.startsWith(">")) fresh.push(line);
  }
  return fresh.join("\n").replace(/https?:\/\/\S+/gi, " ").slice(0, 4_000);
}

export function isOptOutRequest(text: string) {
  const fresh = freshReplyText(text);
  return /\b(?:unsubscribe(?: me)?|remove me|stop (?:emailing|contacting) me|do not contact me|n[aã]o quero receber|removam[- ]me|retirem[- ]me|parem? de enviar)\b/i.test(fresh);
}

export function isAutomaticReply(message: InboundProviderMessage) {
  if (message.autoSubmitted && message.autoSubmitted.toLowerCase() !== "no") return true;
  return /\b(automatic reply|auto(?:matic)?[ -]?reply|out of office|fora do escrit[oó]rio|resposta autom[aá]tica|vacation reply)\b/i.test(`${message.subject}\n${message.text.slice(0, 500)}`);
}

export function classifyReply(message: InboundProviderMessage) {
  const text = freshReplyText(`${message.subject}\n${message.text}`).toLowerCase();
  if (isAutomaticReply(message)) return "auto_reply" as const;
  if (isOptOutRequest(text) || /\b(?:not interested|sem interesse|n[aã]o tenho interesse|n[aã]o obrigado)\b/i.test(text)) return "negative" as const;
  if (/\b(?:interessad[oa]s?|vamos falar|marcar (?:uma )?reuni[aã]o|schedule|sounds good|let'?s talk|sim[,!. ]|yes[,!. ])\b/i.test(text)) return "positive" as const;
  if (/\b(?:preço|preco|budget|orçamento|orcamento|timing|already use|j[aá] usamos)\b/i.test(text)) return "objection" as const;
  if (text.includes("?")) return "question" as const;
  return "unclassified" as const;
}
