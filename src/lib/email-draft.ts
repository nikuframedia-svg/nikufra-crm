import type { Lead } from "../types";

const roleMailboxes = new Set([
  "admin", "apoio", "billing", "comercial", "contact", "contacto", "geral", "hello",
  "info", "marketing", "office", "sales", "support", "suporte",
]);

function titleCaseName(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toLocaleUpperCase("pt-PT") + part.slice(1).toLocaleLowerCase("pt-PT"))
    .join(" ");
}

function nameFromEmail(email: string) {
  const local = email.trim().toLocaleLowerCase("pt-PT").split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length < 2 || roleMailboxes.has(parts[0]) || !/^[\p{L}]{2,}$/u.test(parts[0])) return "";
  return titleCaseName(parts[0]);
}

export function contactFirstName(name: string, email: string) {
  const cleanName = name.trim();
  if (!cleanName || cleanName.includes("@") || cleanName.toLocaleLowerCase("pt-PT") === email.trim().toLocaleLowerCase("pt-PT")) {
    return nameFromEmail(email);
  }
  if (["contacto", "contacto google", "sem nome"].includes(cleanName.toLocaleLowerCase("pt-PT")) || roleMailboxes.has(cleanName.toLocaleLowerCase("pt-PT"))) return nameFromEmail(email);
  return titleCaseName(cleanName.split(/\s+/)[0]);
}

export function senderDisplayName(name?: string) {
  const cleanName = name?.trim() ?? "";
  return cleanName && !cleanName.includes("@") ? titleCaseName(cleanName) : "Equipa Nikufra";
}

export function renderDraftTemplate(text: string, lead: Pick<Lead, "nome" | "email" | "empresa" | "vertical">, senderName?: string) {
  const firstName = contactFirstName(lead.nome, lead.email);
  const verticalContext = lead.vertical === "Outro" ? "" : ` em ${lead.vertical}`;
  return text
    .replaceAll("Olá {{nome}},", firstName ? `Olá ${firstName},` : "Olá,")
    .replaceAll("{{nome}}", firstName)
    .replaceAll("{{empresa}}", lead.empresa.trim())
    .replaceAll(" em {{vertical}}", verticalContext)
    .replaceAll("{{vertical}}", lead.vertical === "Outro" ? "" : lead.vertical)
    .replaceAll("{{remetente}}", senderDisplayName(senderName));
}
