import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getPersona: vi.fn(),
  savePersona: vi.fn(),
  getWhatsappSession: vi.fn(),
  saveWhatsappSession: vi.fn(),
}));
const groqMock = vi.hoisted(() => vi.fn());
const waMocks = vi.hoisted(() => ({ requestLiveQr: vi.fn(), requestLivePairingCode: vi.fn(), isCurrentQrSession: vi.fn(() => true) }));

vi.mock("./db", () => ({ ...dbMocks, PUBLIC_OWNER_ID: 0 }));
vi.mock("./whatsappService", () => waMocks);
vi.mock("./groq", () => ({ invokeGroq: groqMock }));

import { appRouter } from "./routers";

const persona = {
  ownerId: 42, id: 1, assistantName: "Firebox AI", tone: "Warm", role: "Guide",
  behaviorInstructions: "Answer clearly and helpfully.", welcomeMessage: "Hi there!",
  guardrails: "Never expose secrets or invent links.", enabledActions: '["firebox"]',
  createdAt: new Date(), updatedAt: new Date(),
};
const session = {
  ownerId: 42, id: 1, status: "not_configured" as const, phoneNumber: null, pairingCode: null,
  qrPayload: null, expiresAt: null, lastConnectedAt: null, lastError: null, createdAt: new Date(), updatedAt: new Date(),
};
const PUBLIC_OWNER_ID = 0;
const ctx = () => ({ user: null, req: {} as any, res: {} as any });

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getPersona.mockResolvedValue(persona);
  dbMocks.savePersona.mockImplementation(async (ownerId: number, input: object) => ({ ...persona, ownerId, ...input }));
  dbMocks.getWhatsappSession.mockResolvedValue(session);
  dbMocks.saveWhatsappSession.mockImplementation(async (ownerId: number, input: object) => ({ ...session, ownerId, ...input }));
  groqMock.mockResolvedValue("A helpful preview response.");
  waMocks.requestLiveQr.mockResolvedValue({ qrImage: "data:image/png;base64,live", expiresAt: new Date(Date.now() + 120000) });
  waMocks.requestLivePairingCode.mockResolvedValue({ pairingCode: "ABCD-1234", expiresAt: new Date(Date.now() + 120000) });
});

describe("public Firebox control-center procedures", () => {
  it("allows unauthenticated persona reads and writes in the public workspace", async () => {
    const caller = appRouter.createCaller(ctx());
    await caller.controlCenter.getPersona();
    expect(dbMocks.getPersona).toHaveBeenCalledWith(PUBLIC_OWNER_ID);
    await caller.controlCenter.savePersona({ ...persona, enabledActions: ["firebox"] });
    expect(dbMocks.savePersona).toHaveBeenCalledWith(PUBLIC_OWNER_ID, expect.objectContaining({ enabledActions: '["firebox"]' }));
  });

  it("returns pairing metadata with expiry and strips raw QR payload from general output", async () => {
    const caller = appRouter.createCaller(ctx());
    dbMocks.getWhatsappSession.mockResolvedValueOnce({ ...session, status: "waiting_qr" });
    const result = await caller.controlCenter.refreshQr();
    expect(result.status).toBe("waiting_qr");
    expect(result.qrImage).toMatch(/^data:image\/png;base64,/);
    expect(result).not.toHaveProperty("qrPayload");
    expect(result.expiresAt).toBeInstanceOf(Date);
    const pairing = await caller.controlCenter.requestPairingCode({ phoneNumber: "+254769564723" });
    expect(pairing.pairingCode).toMatch(/^[A-F0-9]{4}-[A-F0-9]{4}$/);
    expect(waMocks.requestLiveQr).toHaveBeenCalledWith(PUBLIC_OWNER_ID);
    expect(waMocks.requestLivePairingCode).toHaveBeenCalledWith(PUBLIC_OWNER_ID, "+254769564723");
    expect(pairing.expiresAt).toBeInstanceOf(Date);
  });

  it("previews with the saved persona and falls back when the model fails", async () => {
    const caller = appRouter.createCaller(ctx());
    const success = await caller.controlCenter.preview({ message: "Hello" });
    expect(success.message).toBe("A helpful preview response.");
    expect(groqMock).toHaveBeenCalled();
    groqMock.mockRejectedValueOnce(new Error("provider offline"));
    const fallback = await caller.controlCenter.preview({ message: "Hello again" });
    expect(fallback.message).toMatch(/temporarily unavailable/i);
  });
});
