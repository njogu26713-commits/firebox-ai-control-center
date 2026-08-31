import { MongoClient, type Db } from "mongodb";
import { ENV } from "./_core/env";

export type User = {
  id: number; openId: string; name: string | null; email: string | null; loginMethod: string | null;
  role: "user" | "admin"; createdAt: Date; updatedAt: Date; lastSignedIn: Date;
};

type UserInput = {
  openId: string;
  name?: string | null;
  email?: string | null;
  loginMethod?: string | null;
  role?: "user" | "admin";
  lastSignedIn?: Date;
};

export type Persona = {
  ownerId: number; id: number | string; assistantName: string; tone: string; role: string;
  behaviorInstructions: string; welcomeMessage: string; guardrails: string; enabledActions: string;
  createdAt: Date; updatedAt: Date;
};

export type WhatsappSession = {
  ownerId: number; id: number | string; status: "not_configured" | "waiting_qr" | "waiting_pairing" | "connected" | "error";
  phoneNumber: string | null; pairingCode: string | null; qrPayload: string | null; qrSessionId: string | null;
  expiresAt: Date | null; lastConnectedAt: Date | null; lastError: string | null; createdAt: Date; updatedAt: Date;
};

// Anonymous visitors share this workspace. Authenticated users can still use their existing owner ID.
export const PUBLIC_OWNER_ID = 0;

const defaultPersona = {
  assistantName: "Firebox AI",
  tone: "Warm, concise, and capable",
  role: "WhatsApp automation guide",
  behaviorInstructions: "Answer naturally, ask one clarifying question when needed, and make the next best step obvious.",
  welcomeMessage: "Hi, I’m Firebox AI. What can I help you build today?",
  guardrails: "Never invent links, expose credentials, execute code, or claim an action was completed when it was not.",
  enabledActions: JSON.stringify(["whatsapp_bots", "automation", "deployment", "github", "contact", "firebox"]),
};

let client: MongoClient | null = null;
let database: Db | null = null;
let connectPromise: Promise<Db | null> | null = null;
let indexesReady = false;

export async function getDb() {
  if (database) return database;
  if (!process.env.MONGODB_URI) {
    console.warn("[Database] MONGODB_URI is not configured");
    return null;
  }
  if (!connectPromise) {
    connectPromise = (async () => {
      try {
        client = new MongoClient(process.env.MONGODB_URI!, { serverSelectionTimeoutMS: 5000 });
        await client.connect();
        database = client.db(process.env.MONGODB_DB_NAME ?? "firebox");
        if (!indexesReady) {
          await Promise.all([
            database.collection("users").createIndex({ openId: 1 }, { unique: true }),
            database.collection("personas").createIndex({ ownerId: 1 }, { unique: true }),
            database.collection("whatsappSessions").createIndex({ ownerId: 1 }, { unique: true }),
          ]);
          indexesReady = true;
        }
        return database;
      } catch (error) {
        console.warn("[Database] MongoDB connection failed:", error);
        client = null;
        database = null;
        connectPromise = null;
        return null;
      }
    })();
  }
  return connectPromise;
}

function stableUserId(openId: string) {
  let hash = 0;
  for (const char of openId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash) || 1;
}

export async function upsertUser(user: UserInput): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const now = user.lastSignedIn ?? new Date();
  const update = {
    id: stableUserId(user.openId),
    openId: user.openId,
    name: user.name ?? null,
    email: user.email ?? null,
    loginMethod: user.loginMethod ?? null,
    role: user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user"),
    lastSignedIn: now,
    updatedAt: now,
  };
  await db.collection("users").updateOne({ openId: user.openId }, { $set: update, $setOnInsert: { createdAt: now } }, { upsert: true });
}

export async function getUserByOpenId(openId: string): Promise<User | undefined> {
  const db = await getDb();
  if (!db) return undefined;
  const row = await db.collection("users").findOne({ openId }) as unknown as Partial<User> | null;
  if (!row?.openId) return undefined;
  return {
    id: row.id ?? stableUserId(openId), openId: row.openId, name: row.name ?? null, email: row.email ?? null,
    loginMethod: row.loginMethod ?? null, role: row.role ?? "user", createdAt: row.createdAt ?? new Date(),
    updatedAt: row.updatedAt ?? new Date(), lastSignedIn: row.lastSignedIn ?? new Date(),
  };
}

export async function getPersona(ownerId: number): Promise<Persona> {
  const db = await getDb();
  if (!db) return { ownerId, id: 0, ...defaultPersona, createdAt: new Date(), updatedAt: new Date() };
  const row = await db.collection("personas").findOne({ ownerId }) as unknown as (Partial<Persona> & { _id?: unknown }) | null;
  return row ? { ...(row as Persona), id: String(row._id ?? row.id) } : { ownerId, id: 0, ...defaultPersona, createdAt: new Date(), updatedAt: new Date() };
}

export async function savePersona(ownerId: number, input: typeof defaultPersona) {
  const db = await getDb();
  const now = new Date();
  if (!db) return { ownerId, id: 0, ...input, createdAt: now, updatedAt: now };
  await db.collection("personas").updateOne({ ownerId }, { $set: { ownerId, ...input, updatedAt: now }, $setOnInsert: { createdAt: now } }, { upsert: true });
  return getPersona(ownerId);
}

const emptySession = (ownerId: number): WhatsappSession => ({
  ownerId, id: 0, status: "not_configured" as const, phoneNumber: null, pairingCode: null,
  qrPayload: null, qrSessionId: null, expiresAt: null, lastConnectedAt: null, lastError: null,
  createdAt: new Date(), updatedAt: new Date(),
});

export async function getWhatsappSession(ownerId: number): Promise<WhatsappSession> {
  const db = await getDb();
  if (!db) return emptySession(ownerId);
  const row = await db.collection("whatsappSessions").findOne({ ownerId }) as unknown as (Partial<WhatsappSession> & { _id?: unknown }) | null;
  return row ? { ...(row as WhatsappSession), id: String(row._id ?? row.id) } : emptySession(ownerId);
}

export async function saveWhatsappSession(ownerId: number, input: Record<string, unknown>) {
  const db = await getDb();
  const now = new Date();
  if (!db) return { ...(await getWhatsappSession(ownerId)), ...input, updatedAt: now };
  await db.collection("whatsappSessions").updateOne({ ownerId }, { $set: { ownerId, ...input, updatedAt: now }, $setOnInsert: { createdAt: now } }, { upsert: true });
  return getWhatsappSession(ownerId);
}

export async function closeDb() {
  await client?.close();
  client = null;
  database = null;
  connectPromise = null;
  indexesReady = false;
}
