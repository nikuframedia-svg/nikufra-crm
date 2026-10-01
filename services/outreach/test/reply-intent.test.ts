import { describe, expect, it } from "vitest";
import { classifyReply, isAutomaticReply, isOptOutRequest } from "../src/reply-intent.js";

const message = (subject: string, text: string, autoSubmitted: string | null = null) => ({ providerMessageId: "1", providerThreadId: "t", internetMessageId: "i", inReplyTo: null, references: [], from: "lead@example.com", subject, text, receivedAt: new Date().toISOString(), autoSubmitted });

describe("reply classification", () => {
  it("separates automatic replies from human replies", () => {
    expect(isAutomaticReply(message("Automatic reply", "Out of office"))).toBe(true);
    expect(classifyReply(message("Reunião", "Sim, vamos marcar uma reunião."))).toBe("positive");
  });

  it("recognizes Portuguese and English opt-outs", () => {
    expect(isOptOutRequest("Please unsubscribe me")).toBe(true);
    expect(isOptOutRequest("Não quero receber mais emails")).toBe(true);
  });
});
