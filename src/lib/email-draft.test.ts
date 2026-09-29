import { describe, expect, it } from "vitest";
import { renderDraftTemplate } from "./email-draft";
import { base64UrlUtf8, encodeMimeHeader, encodeMimeTextBody } from "../../infra/volumes/functions/_shared/mime";

function decodeBase64Utf8(value: string) {
  const binary = atob(value);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

function decodeMimeHeader(value: string) {
  return value.split("\r\n ").map((word) => {
    const encoded = word.match(/^=\?UTF-8\?B\?(.+)\?=$/)?.[1];
    return encoded ? decodeBase64Utf8(encoded) : word;
  }).join("");
}

describe("renderização de rascunhos", () => {
  it("nunca usa um endereço de email como nome na saudação", () => {
    const text = "Olá {{nome}},\n\nMensagem para {{empresa}} em {{vertical}}.\n\n{{remetente}}";
    const rendered = renderDraftTemplate(text, {
      nome: "joao.mpires@startupportugal.com",
      email: "joao.mpires@startupportugal.com",
      empresa: "Startup Portugal",
      vertical: "Outro",
    }, "joao");

    expect(rendered).toBe("Olá Joao,\n\nMensagem para Startup Portugal.\n\nJoao");
    expect(rendered).not.toContain("@");
    expect(rendered).not.toContain("Outro");
  });

  it("usa uma saudação neutra quando não consegue inferir um nome humano", () => {
    expect(renderDraftTemplate("Olá {{nome}},", {
      nome: "info@empresa.pt",
      email: "info@empresa.pt",
      empresa: "Empresa",
      vertical: "Outro",
    })).toBe("Olá,");
  });
});

describe("MIME dos rascunhos Gmail", () => {
  it("codifica assuntos UTF-8 sem mojibake", () => {
    const subject = "Startup Portugal × Nikufra — uma hipótese concreta";
    const encoded = encodeMimeHeader(subject);
    expect(encoded).not.toContain("Ã");
    expect(decodeMimeHeader(encoded)).toBe(subject);
  });

  it("remove quebras de linha injetadas em cabeçalhos", () => {
    expect(encodeMimeHeader("Assunto\r\nBcc: intruso@example.com")).toBe("Assunto Bcc: intruso@example.com");
  });

  it("preserva acentos no corpo e na mensagem RFC 2822", () => {
    const body = "Olá João,\n\nDecisões mais rápidas.";
    expect(decodeBase64Utf8(encodeMimeTextBody(body).replaceAll("\r\n", ""))).toBe(body);

    const raw = base64UrlUtf8("Subject: teste\r\n\r\nOlá").replaceAll("-", "+").replaceAll("_", "/");
    expect(decodeBase64Utf8(raw.padEnd(Math.ceil(raw.length / 4) * 4, "="))).toContain("Olá");
  });
});
