import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { invokeLLM } from "./_core/llm";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { getPersona, getWhatsappSession, savePersona, saveWhatsappSession } from "./db";
import QRCode from "qrcode";
import { isCurrentQrSession, requestLivePairingCode, requestLiveQr } from "./whatsappService";

const actionIds = ["whatsapp_bots", "automation", "deployment", "github", "contact", "developer", "firebox"] as const;
export const phoneNumberInput = z.string().trim().regex(/^\+?[0-9]{8,15}$/);

export async function presentSession(session: Awaited<ReturnType<typeof getWhatsappSession>>) {
  const { qrPayload, pairingCode, ...safe } = session;
  const qrIsLive = Boolean(qrPayload && isCurrentQrSession(session.ownerId, session.qrSessionId));
  return { ...safe, qrImage: qrIsLive ? await QRCode.toDataURL(qrPayload!, { margin: 1, width: 420 }) : null };
}
export const personaInput = z.object({
  assistantName: z.string().trim().min(2).max(80),
  tone: z.string().trim().min(2).max(80),
  role: z.string().trim().min(2).max(160),
  behaviorInstructions: z.string().trim().min(10).max(3000),
  welcomeMessage: z.string().trim().min(2).max(500),
  guardrails: z.string().trim().min(10).max(3000),
  enabledActions: z.array(z.enum(actionIds)).min(1).max(7),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  controlCenter: router({
    overview: protectedProcedure.query(async ({ ctx }) => ({
      persona: await getPersona(ctx.user.id),
      session: await presentSession(await getWhatsappSession(ctx.user.id)),
      account: { name: ctx.user.name ?? "Firebox owner", email: ctx.user.email ?? "", plan: "Owner workspace" },
    })),
    getPersona: protectedProcedure.query(({ ctx }) => getPersona(ctx.user.id)),
    savePersona: protectedProcedure.input(personaInput).mutation(({ ctx, input }) => savePersona(ctx.user.id, { ...input, enabledActions: JSON.stringify(input.enabledActions) })),
    resetPersona: protectedProcedure.mutation(({ ctx }) => savePersona(ctx.user.id, {
      assistantName: "Firebox AI", tone: "Warm, concise, and capable", role: "WhatsApp automation guide",
      behaviorInstructions: "Answer naturally, ask one clarifying question when needed, and make the next best step obvious.",
      welcomeMessage: "Hi, I’m Firebox AI. What can I help you build today?",
      guardrails: "Never invent links, expose credentials, execute code, or claim an action was completed when it was not.",
      enabledActions: JSON.stringify(actionIds),
    })),
    session: protectedProcedure.query(({ ctx }) => getWhatsappSession(ctx.user.id).then(presentSession)),
    refreshQr: protectedProcedure.mutation(async ({ ctx }) => {
      try {
        const live = await requestLiveQr(ctx.user.id);
        const safe = await presentSession(await getWhatsappSession(ctx.user.id));
        return { ...safe, qrImage: live.qrImage, expiresAt: live.expiresAt };
      } catch (error) {
        await saveWhatsappSession(ctx.user.id, { status: "error", lastError: error instanceof Error ? error.message : "Live QR unavailable" });
        throw error;
      }
    }),
    requestPairingCode: protectedProcedure.input(z.object({ phoneNumber: phoneNumberInput })).mutation(async ({ ctx, input }) => {
      try {
        const live = await requestLivePairingCode(ctx.user.id, input.phoneNumber);
        return { ...(await presentSession(await getWhatsappSession(ctx.user.id))), pairingCode: live.pairingCode, expiresAt: live.expiresAt };
      } catch (error) {
        await saveWhatsappSession(ctx.user.id, { status: "error", lastError: error instanceof Error ? error.message : "Live pairing unavailable" });
        throw error;
      }
    }),
    preview: protectedProcedure.input(z.object({ message: z.string().trim().min(1).max(500) })).mutation(async ({ ctx, input }) => {
      const saved = await getPersona(ctx.user.id);
      const prompt = `You are ${saved.assistantName}. Role: ${saved.role}. Tone: ${saved.tone}. Behavior: ${saved.behaviorInstructions}. Guardrails: ${saved.guardrails}. Respond concisely to this WhatsApp message: ${input.message}`;
      try {
        const result = await invokeLLM({ messages: [{ role: "system", content: prompt }, { role: "user", content: input.message }] });
        const content = result.choices?.[0]?.message?.content;
        return { message: typeof content === "string" ? content : "I’m ready to help. Try another message." };
      } catch (error) {
        console.error("[preview] LLM failed", error);
        return { message: "Preview is temporarily unavailable. Your persona settings are still safe and saved locally in this form." };
      }
    }),
  }),
});

export type AppRouter = typeof appRouter;
