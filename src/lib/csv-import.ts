import type { Stage, Vertical } from "../types";

export type CsvField = "nome" | "empresa" | "email" | "telefone" | "estado" | "data_reuniao" | "cargo" | "vertical" | "responsavel" | "valor" | "oportunidade" | "cidade" | "pais";

export const csvFieldLabels: Record<CsvField, string> = {
  nome: "Nome", empresa: "Empresa", email: "Email", telefone: "Telefone", estado: "Estado",
  data_reuniao: "Data da reunião", cargo: "Cargo", vertical: "Vertical", responsavel: "Responsável",
  valor: "Valor", oportunidade: "Oportunidade", cidade: "Cidade", pais: "País",
};

const aliases: Record<CsvField, string[]> = {
  nome: ["nome", "name", "contacto", "contato", "contact", "lead", "pessoa"],
  empresa: ["empresa", "company", "companhia", "organizacao", "organization", "account", "cliente"],
  email: ["email", "e-mail", "mail", "correio", "endereco de email"],
  telefone: ["telefone", "telemovel", "telefone movel", "phone", "mobile", "numero", "número", "tel"],
  estado: ["estado", "status", "stage", "fase", "etapa", "pipeline"],
  data_reuniao: ["data reuniao", "data da reuniao", "meeting date", "reuniao", "ultima reuniao"],
  cargo: ["cargo", "funcao", "função", "job title", "title", "role"],
  vertical: ["vertical", "industria", "indústria", "industry", "setor", "sector"],
  responsavel: ["responsavel", "responsável", "owner", "assignee", "atribuido", "atribuído"],
  valor: ["valor", "value", "deal value", "montante", "amount"],
  oportunidade: ["oportunidade", "opportunity", "deal", "projeto", "project"],
  cidade: ["cidade", "city", "localidade"],
  pais: ["pais", "país", "country"],
};

function normalize(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[_./-]+/g, " ").replace(/\s+/g, " ").trim();
}

function delimiterScore(text: string, delimiter: string) {
  const firstLines = text.split(/\r?\n/).slice(0, 5);
  return firstLines.reduce((sum, line) => sum + [...line].filter((char) => char === delimiter).length, 0);
}

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  mapping: Array<CsvField | null>;
  delimiter: string;
}

export function parseCsv(text: string): ParsedCsv {
  const clean = text.replace(/^\uFEFF/, "").trim();
  const delimiter = [",", ";", "\t", "|"].sort((a, b) => delimiterScore(clean, b) - delimiterScore(clean, a))[0];
  const records: string[][] = [];
  let row: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (char === '"' && clean[index + 1] === '"' && quoted) { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && clean[index + 1] === "\n") index += 1;
      row.push(cell.trim()); if (row.some(Boolean)) records.push(row); row = []; cell = "";
    } else cell += char;
  }
  row.push(cell.trim()); if (row.some(Boolean)) records.push(row);
  const headers = records.shift() ?? [];
  const rows = records.map((record) => headers.map((_, index) => record[index] ?? ""));
  return { headers, rows, mapping: inferCsvMapping(headers, rows), delimiter };
}

export function inferCsvMapping(headers: string[], rows: string[][]) {
  const mapping: Array<CsvField | null> = headers.map((header) => {
    const normalized = normalize(header);
    return (Object.entries(aliases).find(([, values]) => values.some((value) => normalize(value) === normalized))?.[0] as CsvField | undefined) ?? null;
  });
  const used = new Set(mapping.filter(Boolean));
  for (let column = 0; column < headers.length; column += 1) {
    if (mapping[column]) continue;
    const values = rows.slice(0, 100).map((row) => row[column]?.trim()).filter(Boolean);
    if (!values.length) continue;
    const ratio = (predicate: (value: string) => boolean) => values.filter(predicate).length / values.length;
    const inferred = ratio((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) > 0.7 ? "email"
      : ratio((value) => /^\+?[\d\s().-]{7,}$/.test(value)) > 0.7 ? "telefone"
        : ratio((value) => !Number.isNaN(Date.parse(value)) && /\d/.test(value)) > 0.7 ? "data_reuniao"
          : ratio((value) => Boolean(stageFromText(value))) > 0.7 ? "estado" : null;
    if (inferred && !used.has(inferred)) { mapping[column] = inferred; used.add(inferred); }
  }
  return mapping;
}

export function stageFromText(value: string): Stage | null {
  const key = normalize(value);
  if (["nao contactado", "novo", "new", "lead"].includes(key)) return "nao_contactado";
  if (["contactado", "contacted", "contacto"].includes(key)) return "contactado";
  if (["reuniao marcada", "meeting scheduled", "agendado"].includes(key)) return "reuniao_marcada";
  if (["reuniao", "reuniao feita", "meeting", "met"].includes(key)) return "reuniao_feita";
  if (["proposta", "proposal", "orcamento"].includes(key)) return "proposta";
  if (["piloto", "pilot", "poc"].includes(key)) return "piloto";
  if (["cliente", "client", "customer", "won", "ganho"].includes(key)) return "cliente";
  if (["perdido", "recusado", "rejeitado", "lost", "declined", "rejected"].includes(key)) return "perdido";
  if (["adiado", "on hold", "paused"].includes(key)) return "adiado";
  return null;
}

export function verticalFromText(value: string): Vertical {
  const key = normalize(value);
  if (/metal|machin|tool|mold/.test(key)) return "Metalomecânica";
  if (/auto|mobil/.test(key)) return "Automóvel";
  if (/alumin/.test(key)) return "Alumínio";
  if (/cortic|cork/.test(key)) return "Cortiça";
  if (/composit|carbon/.test(key)) return "Compósitos";
  if (/eletron|electro/.test(key)) return "Eletrónica";
  return "Outro";
}

export function csvRecord(parsed: ParsedCsv, row: string[]) {
  const output: Partial<Record<CsvField, string>> = {};
  parsed.mapping.forEach((field, index) => { if (field) output[field] = row[index]?.trim() ?? ""; });
  return output;
}
