import { beforeEach, describe, expect, it, vi } from "vitest";

const mongoMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  close: vi.fn(),
  db: vi.fn(),
  collection: vi.fn(),
  createIndex: vi.fn(),
  findOne: vi.fn(),
  updateOne: vi.fn(),
}));

vi.mock("mongodb", () => ({
  MongoClient: vi.fn(() => ({ connect: mongoMocks.connect, close: mongoMocks.close, db: mongoMocks.db })),
}));

import { closeDb, getPersona, getWhatsappSession, savePersona, saveWhatsappSession } from "./db";

const persona = {
  ownerId: 18, assistantName: "Firebox AI", tone: "Warm", role: "Guide",
  behaviorInstructions: "Answer clearly and helpfully.", welcomeMessage: "Hi there!",
  guardrails: "Never expose secrets.", enabledActions: "[\"firebox\"]",
  createdAt: new Date(), updatedAt: new Date(),
};

const session = {
  ownerId: 18, status: "not_configured", phoneNumber: null, pairingCode: null,
  qrPayload: null, qrSessionId: null, expiresAt: null, lastConnectedAt: null, lastError: null,
  createdAt: new Date(), updatedAt: new Date(),
};

beforeEach(async () => {
  await closeDb();
  process.env.MONGODB_URI = "mongodb://railway-test";
  vi.clearAllMocks();
  mongoMocks.connect.mockResolvedValue(undefined);
  mongoMocks.createIndex.mockResolvedValue(undefined);
  mongoMocks.updateOne.mockResolvedValue({ acknowledged: true });
  mongoMocks.db.mockReturnValue({ collection: mongoMocks.collection });
  mongoMocks.collection.mockReturnValue({
    createIndex: mongoMocks.createIndex,
    findOne: mongoMocks.findOne,
    updateOne: mongoMocks.updateOne,
  });
});

describe("MongoDB persistence adapter", () => {
  it("reads persona data by the authenticated owner ID", async () => {
    mongoMocks.findOne.mockResolvedValueOnce(persona);
    const result = await getPersona(18);
    expect(result.ownerId).toBe(18);
    expect(mongoMocks.findOne).toHaveBeenCalledWith({ ownerId: 18 });
  });

  it("writes WhatsApp session metadata using only the supplied owner ID", async () => {
    mongoMocks.findOne.mockResolvedValueOnce(session);
    await saveWhatsappSession(18, { status: "waiting_qr", lastError: null });
    expect(mongoMocks.updateOne).toHaveBeenCalledWith(
      { ownerId: 18 },
      expect.objectContaining({ $set: expect.objectContaining({ ownerId: 18, status: "waiting_qr" }) }),
      { upsert: true },
    );
  });

  it("keeps persona writes owner-scoped and returns the stored record", async () => {
    mongoMocks.findOne.mockResolvedValueOnce(persona);
    const result = await savePersona(18, {
      assistantName: persona.assistantName,
      tone: persona.tone,
      role: persona.role,
      behaviorInstructions: persona.behaviorInstructions,
      welcomeMessage: persona.welcomeMessage,
      guardrails: persona.guardrails,
      enabledActions: persona.enabledActions,
    });
    expect(result.ownerId).toBe(18);
    expect(mongoMocks.updateOne).toHaveBeenCalledWith(
      { ownerId: 18 },
      expect.objectContaining({ $set: expect.objectContaining({ ownerId: 18 }) }),
      { upsert: true },
    );
  });

  it("returns a safe empty session when MongoDB is unavailable", async () => {
    await closeDb();
    delete process.env.MONGODB_URI;
    const result = await getWhatsappSession(999);
    expect(result.ownerId).toBe(999);
    expect(result.status).toBe("not_configured");
  });
});
