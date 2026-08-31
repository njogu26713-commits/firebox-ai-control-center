import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, personas, users, whatsappSessions } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try { _db = drizzle(process.env.DATABASE_URL); }
    catch (error) { console.warn("[Database] Failed to connect:", error); _db = null; }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId, lastSignedIn: user.lastSignedIn ?? new Date() };
  const updateSet: Record<string, unknown> = { lastSignedIn: values.lastSignedIn };
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) { values[field] = user[field] ?? null; updateSet[field] = user[field] ?? null; }
  }
  if (user.role !== undefined || user.openId === ENV.ownerOpenId) {
    values.role = user.role ?? "admin";
    updateSet.role = values.role;
  }
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

const defaultPersona = {
  assistantName: "Firebox AI",
  tone: "Warm, concise, and capable",
  role: "WhatsApp automation guide",
  behaviorInstructions: "Answer naturally, ask one clarifying question when needed, and make the next best step obvious.",
  welcomeMessage: "Hi, I’m Firebox AI. What can I help you build today?",
  guardrails: "Never invent links, expose credentials, execute code, or claim an action was completed when it was not.",
  enabledActions: JSON.stringify(["whatsapp_bots", "automation", "deployment", "github", "contact", "firebox"]),
};

export async function getPersona(ownerId: number) {
  const db = await getDb();
  if (!db) return { ownerId, id: 0, ...defaultPersona, createdAt: new Date(), updatedAt: new Date() };
  const rows = await db.select().from(personas).where(eq(personas.ownerId, ownerId)).limit(1);
  return rows[0] ?? { ownerId, id: 0, ...defaultPersona, createdAt: new Date(), updatedAt: new Date() };
}

export async function savePersona(ownerId: number, input: typeof defaultPersona) {
  const db = await getDb();
  const values = { ownerId, ...input };
  if (!db) return { ownerId, id: 0, ...input, createdAt: new Date(), updatedAt: new Date() };
  await db.insert(personas).values(values).onDuplicateKeyUpdate({ set: input });
  return getPersona(ownerId);
}

export async function getWhatsappSession(ownerId: number) {
  const db = await getDb();
  if (!db) return { ownerId, id: 0, status: "not_configured" as const, phoneNumber: null, pairingCode: null, qrPayload: null, expiresAt: null, lastConnectedAt: null, lastError: null, createdAt: new Date(), updatedAt: new Date() };
  const rows = await db.select().from(whatsappSessions).where(eq(whatsappSessions.ownerId, ownerId)).limit(1);
  return rows[0] ?? { ownerId, id: 0, status: "not_configured" as const, phoneNumber: null, pairingCode: null, qrPayload: null, expiresAt: null, lastConnectedAt: null, lastError: null, createdAt: new Date(), updatedAt: new Date() };
}

export async function saveWhatsappSession(ownerId: number, input: Partial<typeof whatsappSessions.$inferInsert>) {
  const db = await getDb();
  if (!db) return { ...(await getWhatsappSession(ownerId)), ...input };
  const existing = await getWhatsappSession(ownerId);
  if (existing.id) await db.update(whatsappSessions).set(input).where(eq(whatsappSessions.ownerId, ownerId));
  else await db.insert(whatsappSessions).values({ ownerId, status: "not_configured", ...input });
  return getWhatsappSession(ownerId);
}
