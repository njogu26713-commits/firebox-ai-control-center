import makeWASocket, { Browsers, DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { randomUUID } from "node:crypto";
import { getWhatsappSession, saveWhatsappSession } from "./db";

let socket: ReturnType<typeof makeWASocket> | null = null;
let socketReady: Promise<ReturnType<typeof makeWASocket>> | null = null;
let activeOwnerId: number | null = null;
let latestQr: { ownerId: number; payload: string; sessionId: string; expiresAt: Date } | null = null;
let qrWaiter: ((payload: string) => void) | null = null;

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
        qrWaiter?.(qr);
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
        await saveWhatsappSession(activeOwnerId, { status, lastError: `WhatsApp connection closed (${code ?? "unknown"})` });
        socket = null;
        socketReady = null;
      }
    });
    socket = sock;
    return sock;
  })();
  return socketReady;
}

export async function requestLiveQr(ownerId: number) {
  const sock = await ensureWhatsappSocket(ownerId);
  if (latestQr && latestQr.ownerId === ownerId && latestQr.expiresAt.getTime() > Date.now()) {
    return { qrImage: await QRCode.toDataURL(latestQr.payload, { margin: 1, width: 420 }), expiresAt: latestQr.expiresAt };
  }
  return new Promise<{ qrImage: string; expiresAt: Date }>((resolve, reject) => {
    const timeout = setTimeout(() => { qrWaiter = null; reject(new Error("Timed out waiting for a live WhatsApp QR code")); }, 15000);
    qrWaiter = async (payload) => {
      clearTimeout(timeout);
      const expiresAt = new Date(Date.now() + 120000);
      resolve({ qrImage: await QRCode.toDataURL(payload, { margin: 1, width: 420 }), expiresAt });
    };
    if (!sock) reject(new Error("WhatsApp socket is unavailable"));
  });
}

export async function requestLivePairingCode(ownerId: number, phoneNumber: string) {
  const sock = await ensureWhatsappSocket(ownerId);
  if (sock.user) throw new Error("WhatsApp is already connected");
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
