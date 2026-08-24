import { describe, expect, it } from "vitest";
import { csvRecord, parseCsv, stageFromText } from "./csv-import";

describe("importação CSV inteligente", () => {
  it("deteta nomes de coluna e delimitador", () => {
    const parsed = parseCsv("Contact;Company;E-mail;Phone;Status;Meeting date\nAna Silva;Ficosa;ana@ficosa.com;+351 910 000 000;Cliente;2026-08-10");
    expect(parsed.delimiter).toBe(";");
    expect(csvRecord(parsed, parsed.rows[0])).toMatchObject({ nome: "Ana Silva", empresa: "Ficosa", email: "ana@ficosa.com", telefone: "+351 910 000 000", estado: "Cliente", data_reuniao: "2026-08-10" });
  });

  it("preserva vírgulas e quebras dentro de campos entre aspas", () => {
    const parsed = parseCsv('nome,empresa,email\n"Silva, Ana","Empresa\nIndustrial",ana@example.com');
    expect(parsed.rows[0]).toEqual(["Silva, Ana", "Empresa\nIndustrial", "ana@example.com"]);
  });

  it("normaliza estados em português e inglês", () => {
    expect(stageFromText("Reunião")).toBe("reuniao_feita");
    expect(stageFromText("Won")).toBe("cliente");
  });
});
