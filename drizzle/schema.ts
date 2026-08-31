import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const personas = mysqlTable("personas", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull().unique(),
  assistantName: varchar("assistantName", { length: 80 }).notNull().default("Firebox AI"),
  tone: varchar("tone", { length: 80 }).notNull().default("Warm, concise, and capable"),
  role: varchar("role", { length: 160 }).notNull().default("WhatsApp automation guide"),
  behaviorInstructions: text("behaviorInstructions").notNull(),
  welcomeMessage: text("welcomeMessage").notNull(),
  guardrails: text("guardrails").notNull(),
  enabledActions: text("enabledActions").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const whatsappSessions = mysqlTable("whatsappSessions", {
  id: int("id").autoincrement().primaryKey(),
  ownerId: int("ownerId").notNull().unique(),
  status: mysqlEnum("status", ["not_configured", "waiting_qr", "waiting_pairing", "connected", "expired", "error"]).notNull().default("not_configured"),
  phoneNumber: varchar("phoneNumber", { length: 32 }),
  pairingCode: varchar("pairingCode", { length: 32 }),
  qrPayload: text("qrPayload"),
  expiresAt: timestamp("expiresAt"),
  lastConnectedAt: timestamp("lastConnectedAt"),
  lastError: text("lastError"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Persona = typeof personas.$inferSelect;
export type WhatsappSession = typeof whatsappSessions.$inferSelect;
