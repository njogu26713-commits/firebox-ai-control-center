import makeWASocket, { Browsers, DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { access, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getWhatsappSession, PUBLIC_OWNER_ID, saveWhatsappSession } from "./db";
import { createQrWaiter } from "./qrWaiter";

let socket: ReturnType<typeof makeWASocket> | null = null;
let socketReady: Promise<ReturnType<typeof makeWASocket>> | null = null;
let activeOwnerId: number | null = null;
let latestQr: { ownerId: number; payload: string; sessionId: string; expiresAt: Date } | null = null;
let qrWaiter: ReturnType<typeof createQrWaiter> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let resettingForPairing = false;
let shuttingDown = false;

const authDir = process.env.WHATSAPP_AUTH_DIR ?? "./whatsapp_auth";
const MAX_RECONNECT_DELAY_MS = 30_000;

function cancelReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(ownerId: number) {
  if (shuttingDown || resettingForPairing || reconnectTimer || activeOwnerId !== ownerId) return;
  const delay = Math.min(MAX_RECONNECT_DELAY_MS, 750 * 2 ** reconnectAttempts);
  reconnectAttempts = Math.min(reconnectAttempts + 1, 6);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (shuttingDown || activeOwnerId !== ownerId) return;
    console.info(`[WhatsApp] Reconnecting socket for owner ${ownerId}`);
    void ensureWhatsappSocket(ownerId).catch(error => {
      console.warn("[WhatsApp] Reconnect attempt failed:", error);
      scheduleReconnect(ownerId);
    });
  }, delay);
}

export async function ensureWhatsappSocket(ownerId: number) {
  activeOwnerId = ownerId;
  if (shuttingDown) throw new Error("WhatsApp service is shutting down");
  if (socket) return socket;
  if (socketReady) return socketReady;
  socketReady = (async () => {
    try {
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
          reconnectAttempts = 0;
          latestQr = null;
          await saveWhatsappSession(activeOwnerId, { status: "connected", qrPayload: null, qrSessionId: null, pairingCode: null, lastConnectedAt: new Date(), lastError: null });
        }
        if (connection === "close" && activeOwnerId) {
          const code = (lastDisconnect?.error as any)?.output?.statusCode;
          const status = code === DisconnectReason.loggedOut ? "error" : "expired";
          const isCurrentSocket = socket === sock;
          console.warn(`[WhatsApp] Connection closed with code ${code ?? "unknown"}; ${status === "expired" ? "retrying" : "manual re-pair required"}`);
          await saveWhatsappSession(activeOwnerId, { status, lastError: `WhatsApp connection closed (${code ?? "unknown"})` });
          if (isCurrentSocket) {
            socket = null;
            socketReady = null;
          }
          if (!resettingForPairing && code !== DisconnectReason.loggedOut && activeOwnerId && isCurrentSocket) {
            scheduleReconnect(activeOwnerId);
          }
        }
      });
      socket = sock;
      return sock;
    } catch (error) {
      socket = null;
      socketReady = null;
      throw error;
    }
  })();
  return socketReady;
}

/** Restore the persisted Baileys session after a process restart, if one exists. */
export async function restoreWhatsappOnStartup(ownerId = PUBLIC_OWNER_ID) {
  if (shuttingDown) return false;
  try {
    await access(join(authDir, "creds.json"));
  } catch {
    console.info(`[WhatsApp] No persisted auth state found at ${authDir}; waiting for pairing`);
    return false;
  }
  console.info(`[WhatsApp] Restoring persisted session for owner ${ownerId}`);
  try {
    await ensureWhatsappSocket(ownerId);
    return true;
  } catch (error) {
    console.warn("[WhatsApp] Startup restore failed; automatic reconnect will retry:", error);
    scheduleReconnect(ownerId);
    return false;
  }
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
  cancelReconnect();
  try {
    if (socket) {
      try { socket.end(new Error("fresh pairing session requested")); } catch { /* socket already closed */ }
    }
    socket = null;
    socketReady = null;
    latestQr = null;
    await rm(authDir, { recursive: true, force: true });
  } finally {
    resettingForPairing = false;
  }
  await ensureWhatsappSocket(ownerId);
  const currentQr = latestQr as { ownerId: number; payload: string; sessionId: string; expiresAt: Date } | null;
  const payload = currentQr && currentQr.ownerId === ownerId && currentQr.expiresAt.getTime() > Date.now() ? currentQr.payload : await pendingQr.promise;
  const expiresAt = currentQr?.ownerId === ownerId && currentQr.expiresAt.getTime() > Date.now() ? currentQr.expiresAt : new Date(Date.now() + 120000);
  pendingQr.cancel();
  qrWaiter = null;
  return { qrImage: await QRCode.toDataURL(payload, { margin: 1, width: 420 }), expiresAt };
}

export async function requestLivePairingCode(ownerId: number, phoneNumber: string) {
  let sock = await ensureWhatsappSocket(ownerId);
  if ((sock as any).authState?.creds?.registered || sock.user) throw new Error("WhatsApp is already connected");
  if (!latestQr || latestQr.ownerId !== ownerId || latestQr.expiresAt.getTime() <= Date.now()) {
    await waitForQrEvent(20000).promise;
    // The original socket may have been replaced after a restartRequired/515 close.
    sock = await ensureWhatsappSocket(ownerId);
  }
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

/** Stop reconnect timers and close the socket during a Railway shutdown. */
export function shutdownWhatsapp() {
  shuttingDown = true;
  cancelReconnect();
  qrWaiter?.cancel();
  qrWaiter = null;
  const currentSocket = socket;
  socket = null;
  socketReady = null;
  latestQr = null;
  if (currentSocket) {
    try { currentSocket.end(new Error("service shutting down")); } catch { /* socket already closed */ }
  }
}
