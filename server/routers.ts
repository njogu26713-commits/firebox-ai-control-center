import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { invokeGroq } from "./groq";
import { publicProcedure, router } from "./_core/trpc";
import { getPersona, getWhatsappSession, PUBLIC_OWNER_ID, savePersona, saveWhatsappSession } from "./db";
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

function workspaceOwnerId(ctx: { user?: { id: number } | null }) {
  return ctx.user?.id ?? PUBLIC_OWNER_ID;
}

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
    overview: publicProcedure.query(async ({ ctx }) => ({
      persona: await getPersona(workspaceOwnerId(ctx)),
      session: await presentSession(await getWhatsappSession(workspaceOwnerId(ctx))),
      account: {
        name: ctx.user?.name ?? "Public Firebox workspace",
        email: ctx.user?.email ?? "",
        plan: ctx.user ? "Owner workspace" : "Public workspace",
      },
    })),
    getPersona: publicProcedure.query(({ ctx }) => getPersona(workspaceOwnerId(ctx))),
    savePersona: publicProcedure.input(personaInput).mutation(({ ctx, input }) => savePersona(workspaceOwnerId(ctx), { ...input, enabledActions: JSON.stringify(input.enabledActions) })),
    resetPersona: publicProcedure.mutation(({ ctx }) => savePersona(workspaceOwnerId(ctx), {
      assistantName: "Firebox AI", tone: "Warm, concise, and capable", role: "WhatsApp automation guide",
      behaviorInstructions: "Answer naturally, ask one clarifying question when needed, and make the next best step obvious.",
      welcomeMessage: "Hi, I’m Firebox AI. What can I help you build today?",
      guardrails: "Never invent links, expose credentials, execute code, or claim an action was completed when it was not.",
      enabledActions: JSON.stringify(actionIds),
    })),
    session: publicProcedure.query(({ ctx }) => getWhatsappSession(workspaceOwnerId(ctx)).then(presentSession)),
    refreshQr: publicProcedure.mutation(async ({ ctx }) => {
      try {
        const live = await requestLiveQr(workspaceOwnerId(ctx));
        const safe = await presentSession(await getWhatsappSession(workspaceOwnerId(ctx)));
        return { ...safe, qrImage: live.qrImage, expiresAt: live.expiresAt };
      } catch (error) {
        await saveWhatsappSession(workspaceOwnerId(ctx), { status: "error", lastError: error instanceof Error ? error.message : "Live QR unavailable" });
        throw error;
      }
    }),
    requestPairingCode: publicProcedure.input(z.object({ phoneNumber: phoneNumberInput })).mutation(async ({ ctx, input }) => {
      try {
        const live = await requestLivePairingCode(workspaceOwnerId(ctx), input.phoneNumber);
        return { ...(await presentSession(await getWhatsappSession(workspaceOwnerId(ctx)))), pairingCode: live.pairingCode, expiresAt: live.expiresAt };
      } catch (error) {
        await saveWhatsappSession(workspaceOwnerId(ctx), { status: "error", lastError: error instanceof Error ? error.message : "Live pairing unavailable" });
        throw error;
      }
    }),
    preview: publicProcedure.input(z.object({ message: z.string().trim().min(1).max(500) })).mutation(async ({ ctx, input }) => {
      const saved = await getPersona(workspaceOwnerId(ctx));
      const prompt = `You are ${saved.assistantName}. Role: ${saved.role}. Tone: ${saved.tone}. Behavior: ${saved.behaviorInstructions}. Guardrails: ${saved.guardrails}. Respond concisely to this WhatsApp message: ${input.message}`;
      try {
        const content = await invokeGroq([{ role: "system", content: prompt }, { role: "user", content: input.message }]);
        return { message: content };
      } catch (error) {
        console.error("[preview] LLM failed", error);
        return { message: "Preview is temporarily unavailable. Your persona settings are still safe and saved locally in this form." };
      }
    }),
  }),
});

export type AppRouter = typeof appRouter;
