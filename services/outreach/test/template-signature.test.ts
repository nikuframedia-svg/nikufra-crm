import { describe, expect, it } from "vitest";
import { campaignInputSchema } from "../src/mutations.js";
import { recipientNameInSignature } from "../src/template.js";

const body = "Bom dia {{nome}},\n\nTem 20 minutos para conversar?\n\nObrigada,\n- {{nome}}";

describe("assinatura da campanha", () => {
  it("recusa o nome do destinatário na assinatura sem bloquear a saudação", () => {
    expect(recipientNameInSignature(body)).toBe(true);
    expect(campaignInputSchema.safeParse({
      name: "Teste",
      steps: [{ variants: [{ subject: "Olá", body }] }],
    }).success).toBe(false);
  });

  it("aceita o nome da remetente na assinatura", () => {
    const corrected = body.replace(/\{\{nome\}\}$/, "{{remetente}}");
    expect(recipientNameInSignature(corrected)).toBe(false);
    expect(campaignInputSchema.safeParse({
      name: "Teste",
      steps: [{ variants: [{ subject: "Olá", body: corrected }] }],
    }).success).toBe(true);
  });
});
