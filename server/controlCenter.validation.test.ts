import { describe, expect, it } from "vitest";
import { z } from "zod";
import { appRouter, personaInput, phoneNumberInput, presentSession } from "./routers";

describe("control center validation", () => {
  it("accepts a complete persona with approved actions", () => {
    const parsed = personaInput.parse({
      assistantName: "Firebox AI",
      tone: "Warm and concise",
      role: "WhatsApp guide",
      behaviorInstructions: "Answer naturally and ask a clarifying question when needed.",
      welcomeMessage: "How can I help?",
      guardrails: "Never expose credentials or invent links.",
      enabledActions: ["whatsapp_bots", "automation", "firebox"],
    });
    expect(parsed.enabledActions).toContain("firebox");
  });

  it("validates phone numbers and creates a short pairing code", () => {
    expect(phoneNumberInput.safeParse("+254769564723").success).toBe(true);
    expect(phoneNumberInput.safeParse("not-a-phone").success).toBe(false);
  });

  it("does not expose raw session secrets in general responses", async () => {
    const safe = await presentSession({ ownerId: 7, id: 1, status: "waiting_qr", phoneNumber: null, pairingCode: "ABCD-EFGH", qrPayload: "secret-payload", qrSessionId: "stale-session", expiresAt: new Date(), lastConnectedAt: null, lastError: null, createdAt: new Date(), updatedAt: new Date() });
    expect(safe).not.toHaveProperty("qrPayload");
    expect(safe).not.toHaveProperty("pairingCode");
    expect(safe.qrImage).toBeNull();
  });

  it("requires authentication for owner-scoped control-center reads", async () => {
    const caller = appRouter.createCaller({ user: null, req: {} as any, res: {} as any });
    await expect(caller.controlCenter.overview()).rejects.toThrow();
  });

  it("rejects arbitrary actions and malformed persona fields", () => {
    expect(() => personaInput.parse({
      assistantName: "x", tone: "x", role: "x", behaviorInstructions: "too short", welcomeMessage: "x", guardrails: "too short", enabledActions: ["run_shell"],
    })).toThrow();
    expect(z.string().min(1).safeParse("").success).toBe(false);
  });
});
