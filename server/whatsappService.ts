import makeWASocket, { Browsers, DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { getWhatsappSession, saveWhatsappSession } from "./db";
import { createQrWaiter } from "./qrWaiter";

let socket: ReturnType<typeof makeWASocket> | null = null;
let socketReady: Promise<ReturnType<typeof makeWASocket>> | null = null;
let activeOwnerId: number | null = null;
let latestQr: { ownerId: number; payload: string; sessionId: string; expiresAt: Date } | null = null;
let qrWaiter: ReturnType<typeof createQrWaiter> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let resettingForPairing = false;

const authDir = process.env.WHATSAPP_AUTH_DIR ?? "./whatsapp_auth";

export async function ensureWhatsappSocket(ownerId: number) {
  activeOwnerId = ownerId;
  if (socket) return socket;
  if (socketReady) return socketReady;
  socketReady = (async () => {
    const { state, saveCreds } = await useMultiFileAuthState(authDir);
    const sock = makeWASocket({
      auth: state,
      browser: Browsers.ubuntu("Firebox AI"),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
      if (qr && activeOwnerId) {
        const expiresAt = new Date(Date.now() + 120000);
        const sessionId = randomUUID();
        latestQr = { ownerId: activeOwnerId, payload: qr, sessionId, expiresAt };
        console.info(`[WhatsApp] Live QR emitted for owner ${activeOwnerId}`);
        qrWaiter?.resolve(qr);
        qrWaiter = null;
        await saveWhatsappSession(activeOwnerId, { status: "waiting_qr", qrPayload: qr, qrSessionId: sessionId, pairingCode: null, expiresAt, lastError: null });
      }
      if (connection === "open" && activeOwnerId) {
        latestQr = null;
        await saveWhatsappSession(activeOwnerId, { status: "connected", qrPayload: null, qrSessionId: null, pairingCode: null, lastConnectedAt: new Date(), lastError: null });
      }
      if (connection === "close" && activeOwnerId) {
        const code = (lastDisconnect?.error as any)?.output?.statusCode;
        const status = code === DisconnectReason.loggedOut ? "error" : "expired";
        console.warn(`[WhatsApp] Connection closed with code ${code ?? "unknown"}; ${status === "expired" ? "retrying" : "manual re-pair required"}`);
        await saveWhatsappSession(activeOwnerId, { status, lastError: `WhatsApp connection closed (${code ?? "unknown"})` });
        socket = null;
        socketReady = null;
        if (!resettingForPairing && code !== DisconnectReason.loggedOut && activeOwnerId && !reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (activeOwnerId) {
              console.info(`[WhatsApp] Reconnecting socket for owner ${activeOwnerId}`);
              void ensureWhatsappSocket(activeOwnerId);
            }
          }, 750);
        }
      }
    });
    socket = sock;
    return sock;
  })();
  return socketReady;
}

function waitForQrEvent(timeoutMs = 45000) {
  const waiter = createQrWaiter(timeoutMs);
  qrWaiter = waiter;
  return waiter;
}

export async function requestLiveQr(ownerId: number) {
  if (socket?.user) throw new Error("WhatsApp is already connected");
  const pendingQr = waitForQrEvent();
  resettingForPairing = true;
  if (socket) {
    try { socket.end(new Error("fresh pairing session requested")); } catch { /* socket already closed */ }
  }
  socket = null;
  socketReady = null;
  latestQr = null;
  await rm(authDir, { recursive: true, force: true });
  resettingForPairing = false;
  await ensureWhatsappSocket(ownerId);
  const currentQr = latestQr as { ownerId: number; payload: string; sessionId: string; expiresAt: Date } | null;
  const payload = currentQr && currentQr.ownerId === ownerId && currentQr.expiresAt.getTime() > Date.now() ? currentQr.payload : await pendingQr.promise;
  const expiresAt = currentQr?.ownerId === ownerId && currentQr.expiresAt.getTime() > Date.now() ? currentQr.expiresAt : new Date(Date.now() + 120000);
  pendingQr.cancel();
  qrWaiter = null;
  return { qrImage: await QRCode.toDataURL(payload, { margin: 1, width: 420 }), expiresAt };
}

export async function requestLivePairingCode(ownerId: number, phoneNumber: string) {
  const sock = await ensureWhatsappSocket(ownerId);
  if ((sock as any).authState?.creds?.registered || sock.user) throw new Error("WhatsApp is already connected");
  if (!latestQr || latestQr.ownerId !== ownerId || latestQr.expiresAt.getTime() <= Date.now()) await waitForQrEvent(20000).promise;
  const pairingCode = await sock.requestPairingCode(phoneNumber.replace(/\D/g, ""));
  const expiresAt = new Date(Date.now() + 120000);
  await saveWhatsappSession(ownerId, { status: "waiting_pairing", phoneNumber, pairingCode, qrPayload: null, expiresAt, lastError: null });
  return { pairingCode, expiresAt };
}

export function isCurrentQrSession(ownerId: number, sessionId: string | null | undefined) {
  return Boolean(latestQr && latestQr.ownerId === ownerId && latestQr.sessionId === sessionId && latestQr.expiresAt.getTime() > Date.now());
}

export async function getLiveWhatsappSnapshot(ownerId: number) {
  await ensureWhatsappSocket(ownerId);
  return getWhatsappSession(ownerId);
}
