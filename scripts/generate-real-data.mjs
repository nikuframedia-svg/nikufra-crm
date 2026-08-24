import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const input = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Indica o CSV de leads como primeiro argumento.");

function uuid(key) {
  const hex = createHash("sha256").update(`nikufra:${key}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5"; hex[16] = ((Number.parseInt(hex[16], 16) & 3) | 8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function parse(text) {
  const rows = []; let row = []; let cell = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && text[index + 1] === '"' && quoted) { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && text[index + 1] === "\n") index += 1; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; }
    else cell += char;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift();
  return rows.map((values) => Object.fromEntries(headers.map((key, index) => [key, values[index] ?? ""])));
}

const statusRank = { Contactado: 1, "Reunião": 2, Cliente: 3 };
const statusMap = { Contactado: "contactado", "Reunião": "reuniao_feita", Cliente: "cliente" };
const sourceText = (await readFile(input, "utf8")).replace(/^\uFEFF/, "").trim();
const raw = parse(sourceText);
const contactsByEmail = new Map();
for (const item of raw) {
  const email = item.email.trim().toLowerCase();
  if (!email) continue;
  const current = contactsByEmail.get(email);
  if (!current || (statusRank[item.estado] ?? 0) > (statusRank[current.estado] ?? 0)) contactsByEmail.set(email, { ...item, email });
}
const contacts = [...contactsByEmail.values()];
const companies = new Map();
for (const contact of contacts) {
  const isParticular = /^\(?particular\)?$/i.test(contact.empresa.trim());
  const key = isParticular ? `particular:${contact.email}` : contact.empresa.trim().toLocaleLowerCase("pt");
  const companyName = isParticular ? `${contact.nome.trim()} (particular)` : contact.empresa.trim();
  const company = companies.get(key) ?? { key, id: uuid(`company:${key}`), name: companyName, contacts: [], status: contact.estado, meetingDates: [] };
  company.contacts.push(contact);
  if ((statusRank[contact.estado] ?? 0) > (statusRank[company.status] ?? 0)) company.status = contact.estado;
  if (contact.data_reuniao) company.meetingDates.push(contact.data_reuniao);
  companies.set(key, company);
}

const ownerId = "local-owner";
const realLeads = contacts.map((contact) => {
  const isParticular = /^\(?particular\)?$/i.test(contact.empresa.trim());
  const companyKey = isParticular ? `particular:${contact.email}` : contact.empresa.trim().toLocaleLowerCase("pt");
  const company = companies.get(companyKey);
  return { id: uuid(`contact:${contact.email}`), empresaId: company.id, nome: contact.nome, cargo: "", empresa: company.name, email: contact.email, telefone: contact.numero || "", vertical: "Outro", cidade: "", pais: "PT", origem: "Base Gmail / CSV", estado: statusMap[contact.estado] ?? "contactado", ownerId, dataReuniao: contact.data_reuniao || undefined };
});
const leadByEmail = new Map(realLeads.map((lead) => [lead.email, lead]));
const revenueByCompany = {
  metalogalva: { contracted: 5000, invoiced: 2500 },
  nelo: { contracted: 40000, invoiced: 10000 },
  "jorge pires": { contracted: 6500, invoiced: 0 },
  ficosa: { contracted: 0, invoiced: 1175 },
};
const realOpportunities = [...companies.values()].map((company) => {
  const primary = company.contacts.toSorted((a, b) => (statusRank[b.estado] ?? 0) - (statusRank[a.estado] ?? 0))[0];
  const meetingDate = company.meetingDates.toSorted()[0];
  const values = revenueByCompany[company.name.toLocaleLowerCase("pt")] ?? { contracted: 0, invoiced: 0 };
  return { id: uuid(`opportunity:${company.key}`), leadId: leadByEmail.get(primary.email).id, empresaId: company.id, empresa: company.name, titulo: "Relação comercial", estado: statusMap[company.status] ?? "contactado", tipo: "Consultoria", valor: values.contracted || values.invoiced, probabilidade: company.status === "Cliente" ? 100 : company.status === "Reunião" ? 30 : 5, ownerId, diasNoEstado: meetingDate ? Math.max(0, Math.floor((Date.parse("2026-08-25") - Date.parse(meetingDate)) / 86400000)) : 0, dataPrimeiroContacto: "", dataReuniao: meetingDate, dataFecho: "", dataFechoPrevista: "", notas: "Importado do ficheiro real de contactos." };
});
const opportunityByCompany = new Map(realOpportunities.map((item) => [item.empresaId, item]));
const realActivities = realLeads.filter((lead) => lead.dataReuniao).map((lead) => ({ id: uuid(`meeting:${lead.id}:${lead.dataReuniao}`), oportunidadeId: opportunityByCompany.get(lead.empresaId).id, empresa: lead.empresa, userId: ownerId, tipo: "reuniao", descricao: `Reunião com ${lead.nome}`, data: `${lead.dataReuniao}T12:00:00Z`, contactoId: lead.id }));
const companiesByName = new Map([...companies.values()].map((company) => [company.name.toLocaleLowerCase("pt"), company]));
const billing = [
  ["Metalogalva", "Contratualizado", 5000, undefined, undefined, "Valor indicado: 5 mil euros"],
  ["Metalogalva", "Faturado", 2500, 2500, 0, "Faturação indicada pelo utilizador"],
  ["Nelo", "Contratualizado", 40000, undefined, undefined, "Valor contratualizado indicado pelo utilizador"],
  ["Nelo", "Faturado", 10000, 10000, 0, "Faturação indicada pelo utilizador"],
  ["Jorge Pires", "Contratualizado", 6500, undefined, undefined, "Valor contratualizado indicado pelo utilizador"],
  ["Ficosa", "Faturado", 1175, 1445.25, 270.25, "Base sem IVA; total indicado de 1.445,25 € à taxa de 23%"],
];
const realRevenueEntries = billing.map(([companyName, type, value, gross, vat, description], index) => {
  const company = companiesByName.get(String(companyName).toLocaleLowerCase("pt"));
  const opportunity = company ? opportunityByCompany.get(company.id) : undefined;
  return { id: uuid(`billing:${index}:${companyName}:${type}`), empresaId: company?.id, oportunidadeId: opportunity?.id, data: "2026-08-25", empresa: companyName, descricao: description, tipo: type, valor: value, valorBruto: gross, iva: vat, taxaIva: vat ? 23 : undefined, ref: "Entrada manual" };
});
const realRevenueMonths = ["Set", "Out", "Nov", "Dez", "Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago"].map((mes) => ({ mes, contratualizado: mes === "Ago" ? 51500 : 0, faturado: mes === "Ago" ? 13675 : 0, recebido: 0, objetivo: 0 }));
const companyList = [...companies.values()];
const knownContacted = companyList.length;
const knownMeetings = companyList.filter((company) => statusRank[company.status] >= 2).length;
const clients = companyList.filter((company) => company.status === "Cliente").length;
const realConversionData = [
  { etapa: "Contactado", total: knownContacted, taxa: 100 },
  { etapa: "Reunião feita", total: knownMeetings, taxa: Math.round(1000 * knownMeetings / knownContacted) / 10 },
  { etapa: "Cliente", total: clients, taxa: Math.round(1000 * clients / knownMeetings) / 10 },
];
const meetingsByMonth = new Map();
for (const company of companyList) for (const date of company.meetingDates) { const month = date.slice(0, 7); meetingsByMonth.set(month, (meetingsByMonth.get(month) ?? 0) + 1); }
const realMeetingMonths = [...meetingsByMonth.entries()].toSorted().map(([month, meetings]) => ({ mes: new Date(`${month}-01T12:00:00Z`).toLocaleDateString("pt-PT", { month: "short" }).replace(".", ""), reuniao: meetings }));

const output = `// Gerado mecanicamente a partir do CSV real fornecido em 2026-08-25.\nimport type { Activity, Lead, Opportunity, RevenueEntry, RevenueMonth } from "../types";\n\nexport const realLeads: Lead[] = ${JSON.stringify(realLeads, null, 2)};\n\nexport const realOpportunities: Opportunity[] = ${JSON.stringify(realOpportunities, null, 2)};\n\nexport const realActivities: Activity[] = ${JSON.stringify(realActivities, null, 2)};\n\nexport const realRevenueEntries: RevenueEntry[] = ${JSON.stringify(realRevenueEntries, null, 2)};\n\nexport const realRevenueMonths: RevenueMonth[] = ${JSON.stringify(realRevenueMonths, null, 2)};\n\nexport const realConversionData = ${JSON.stringify(realConversionData, null, 2)};\n\nexport const realMeetingMonths = ${JSON.stringify(realMeetingMonths, null, 2)};\n`;
const generatedPath = resolve("src/data/real-data.generated.ts");
const csvCopyPath = resolve("supabase/imports/nikufra_leads.csv");
await mkdir(dirname(generatedPath), { recursive: true }); await mkdir(dirname(csvCopyPath), { recursive: true });
await writeFile(generatedPath, output); await writeFile(csvCopyPath, `${sourceText}\n`);
console.log(JSON.stringify({ contacts: realLeads.length, companies: realOpportunities.length, meetings: realActivities.length, clients, invoicedNet: 13675, contracted: 51500 }));
