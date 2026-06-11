import { Database } from "bun:sqlite";
import path from "path";

export interface DB {
  getUserByTelegramId(telegramId: number): any | null;
  createUser(telegramId: number, firstName?: string, lastName?: string, username?: string): any;
  ensureUser(telegramId: number, firstName?: string, lastName?: string, username?: string): any;

  addMessage(userId: string, role: string, content: string, messageType?: string, fileName?: string): void;
  getRecentMessages(userId: string, limit?: number): any[];
  getConversationHistory(userId: string, limit?: number): { role: "system" | "user" | "assistant"; content: string }[];

  addReminder(userId: string, text: string, remindAt: Date, isRepeat?: boolean, repeatInterval?: string): any;
  getPendingReminders(): any[];
  markReminderSent(id: string): void;
  getUserReminders(userId: string): any[];
  deleteReminder(id: string): void;

  addShoppingItem(userId: string, text: string, quantity?: string, category?: string): any;
  getShoppingList(userId: string): any[];
  toggleShoppingItem(id: string): void;
  deleteShoppingItem(id: string): void;
  clearBoughtItems(userId: string): void;

  addNote(userId: string, title: string, content: string, tags?: string): any;
  getNotes(userId: string): any[];
  deleteNote(id: string): void;

  getUserContext(userId: string): any | null;
  updateUserContext(userId: string, data: { preferences?: string; conversationSummary?: string }): void;

  getTelegramIdByUserId(userId: string): number | null;
}

/**
 * SQL for creating all tables.
 * This runs on every startup — CREATE TABLE IF NOT EXISTS is safe.
 */
const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS TgUser (
    id TEXT PRIMARY KEY,
    telegramId INTEGER UNIQUE NOT NULL,
    firstName TEXT,
    lastName TEXT,
    username TEXT,
    languageCode TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS Message (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    messageType TEXT DEFAULT 'text',
    fileName TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (userId) REFERENCES TgUser(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS Reminder (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    text TEXT NOT NULL,
    remindAt TEXT NOT NULL,
    isSent INTEGER DEFAULT 0,
    isRepeat INTEGER DEFAULT 0,
    repeatInterval TEXT,
    createdAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (userId) REFERENCES TgUser(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS ShoppingItem (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    text TEXT NOT NULL,
    quantity TEXT DEFAULT '1',
    isBought INTEGER DEFAULT 0,
    category TEXT DEFAULT 'other',
    createdAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (userId) REFERENCES TgUser(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS Note (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT DEFAULT '',
    createdAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (userId) REFERENCES TgUser(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS UserContext (
    id TEXT PRIMARY KEY,
    userId TEXT UNIQUE NOT NULL,
    preferences TEXT DEFAULT '{}',
    conversationSummary TEXT DEFAULT '',
    lastInteraction TEXT DEFAULT (datetime('now')),
    createdAt TEXT DEFAULT (datetime('now')),
    updatedAt TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (userId) REFERENCES TgUser(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS BotSetting (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL
  );

  -- Indexes for performance
  CREATE INDEX IF NOT EXISTS idx_message_userId ON Message(userId);
  CREATE INDEX IF NOT EXISTS idx_reminder_pending ON Reminder(isSent, remindAt);
  CREATE INDEX IF NOT EXISTS idx_reminder_userId ON Reminder(userId);
  CREATE INDEX IF NOT EXISTS idx_shopping_userId ON ShoppingItem(userId);
  CREATE INDEX IF NOT EXISTS idx_note_userId ON Note(userId);
  CREATE INDEX IF NOT EXISTS idx_usercontext_userId ON UserContext(userId);
`;

export function createDB(): DB {
  const dbPath = path.resolve(__dirname, "../../db/custom.db");

  // Ensure db directory exists
  const fs = require("fs");
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const sqlite = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");

  // Auto-create tables on startup
  sqlite.exec(CREATE_TABLES_SQL);
  console.log("✅ Database tables ready");

  return {
    getUserByTelegramId(telegramId: number) {
      return sqlite.query("SELECT * FROM TgUser WHERE telegramId = ?").get(telegramId) as any | null;
    },

    createUser(telegramId: number, firstName?: string, lastName?: string, username?: string) {
      const id = cuid();
      sqlite.query(
        "INSERT INTO TgUser (id, telegramId, firstName, lastName, username, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))"
      ).run(id, telegramId, firstName || null, lastName || null, username || null);
      return sqlite.query("SELECT * FROM TgUser WHERE id = ?").get(id);
    },

    ensureUser(telegramId: number, firstName?: string, lastName?: string, username?: string) {
      let user = this.getUserByTelegramId(telegramId);
      if (!user) {
        user = this.createUser(telegramId, firstName, lastName, username);
        // Create empty context for new user
        sqlite.query(
          "INSERT INTO UserContext (id, userId, preferences, conversationSummary, lastInteraction, createdAt, updatedAt) VALUES (?, ?, '{}', '', datetime('now'), datetime('now'), datetime('now'))"
        ).run(cuid(), user.id);
      } else {
        // Update user info on each interaction
        sqlite.query(
          "UPDATE TgUser SET firstName = ?, lastName = ?, username = ?, updatedAt = datetime('now') WHERE telegramId = ?"
        ).run(firstName || null, lastName || null, username || null, telegramId);
      }
      return user;
    },

    // === Messages ===

    addMessage(userId: string, role: string, content: string, messageType = "text", fileName?: string) {
      sqlite.query(
        "INSERT INTO Message (id, userId, role, content, messageType, fileName, createdAt) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))"
      ).run(cuid(), userId, role, content, messageType, fileName || null);
    },

    getRecentMessages(userId: string, limit = 20) {
      return sqlite.query("SELECT * FROM Message WHERE userId = ? ORDER BY createdAt DESC LIMIT ?")
        .all(userId, limit)
        .reverse();
    },

    getConversationHistory(userId: string, limit = 20): { role: "system" | "user" | "assistant"; content: string }[] {
      const messages = this.getRecentMessages(userId, limit);
      return messages.map((m: any) => ({
        role: m.role as "system" | "user" | "assistant",
        content: m.content,
      }));
    },

    // === Reminders ===

    addReminder(userId: string, text: string, remindAt: Date, isRepeat = false, repeatInterval?: string) {
      const id = cuid();
      sqlite.query(
        "INSERT INTO Reminder (id, userId, text, remindAt, isSent, isRepeat, repeatInterval, createdAt) VALUES (?, ?, ?, ?, 0, ?, ?, datetime('now'))"
      ).run(id, userId, text, remindAt.toISOString(), isRepeat ? 1 : 0, repeatInterval || null);
      return sqlite.query("SELECT * FROM Reminder WHERE id = ?").get(id);
    },

    getPendingReminders() {
      return sqlite.query("SELECT * FROM Reminder WHERE isSent = 0 AND remindAt <= datetime('now')").all();
    },

    markReminderSent(id: string) {
      sqlite.query("UPDATE Reminder SET isSent = 1 WHERE id = ?").run(id);
    },

    getUserReminders(userId: string) {
      return sqlite.query("SELECT * FROM Reminder WHERE userId = ? AND isSent = 0 ORDER BY remindAt ASC").all(userId);
    },

    deleteReminder(id: string) {
      sqlite.query("DELETE FROM Reminder WHERE id = ?").run(id);
    },

    // === Shopping ===

    addShoppingItem(userId: string, text: string, quantity = "1", category = "other") {
      const id = cuid();
      sqlite.query(
        "INSERT INTO ShoppingItem (id, userId, text, quantity, isBought, category, createdAt) VALUES (?, ?, ?, ?, 0, ?, datetime('now'))"
      ).run(id, userId, text, quantity, category);
      return sqlite.query("SELECT * FROM ShoppingItem WHERE id = ?").get(id);
    },

    getShoppingList(userId: string) {
      return sqlite.query("SELECT * FROM ShoppingItem WHERE userId = ? AND isBought = 0 ORDER BY category, createdAt ASC").all(userId);
    },

    toggleShoppingItem(id: string) {
      sqlite.query("UPDATE ShoppingItem SET isBought = CASE WHEN isBought = 0 THEN 1 ELSE 0 END WHERE id = ?").run(id);
    },

    deleteShoppingItem(id: string) {
      sqlite.query("DELETE FROM ShoppingItem WHERE id = ?").run(id);
    },

    clearBoughtItems(userId: string) {
      sqlite.query("DELETE FROM ShoppingItem WHERE userId = ? AND isBought = 1").run(userId);
    },

    // === Notes ===

    addNote(userId: string, title: string, content: string, tags = "") {
      const id = cuid();
      sqlite.query(
        "INSERT INTO Note (id, userId, title, content, tags, createdAt) VALUES (?, ?, ?, ?, ?, datetime('now'))"
      ).run(id, userId, title, content, tags);
      return sqlite.query("SELECT * FROM Note WHERE id = ?").get(id);
    },

    getNotes(userId: string) {
      return sqlite.query("SELECT * FROM Note WHERE userId = ? ORDER BY createdAt DESC").all(userId);
    },

    deleteNote(id: string) {
      sqlite.query("DELETE FROM Note WHERE id = ?").run(id);
    },

    // === User Context ===

    getUserContext(userId: string) {
      return sqlite.query("SELECT * FROM UserContext WHERE userId = ?").get(userId) as any | null;
    },

    updateUserContext(userId: string, data: { preferences?: string; conversationSummary?: string }) {
      const fields: string[] = [];
      const values: any[] = [];
      if (data.preferences !== undefined) {
        fields.push("preferences = ?");
        values.push(data.preferences);
      }
      if (data.conversationSummary !== undefined) {
        fields.push("conversationSummary = ?");
        values.push(data.conversationSummary);
      }
      fields.push("updatedAt = datetime('now')");
      fields.push("lastInteraction = datetime('now')");
      values.push(userId);
      sqlite.query(`UPDATE UserContext SET ${fields.join(", ")} WHERE userId = ?`).run(...values);
    },

    // === Utility ===

    getTelegramIdByUserId(userId: string): number | null {
      const row = sqlite.query("SELECT telegramId FROM TgUser WHERE id = ?").get(userId) as any;
      return row?.telegramId ?? null;
    },
  };
}

// Simple CUID-like ID generator
function cuid(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}${random}`;
}
